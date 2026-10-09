package com.neon.arena.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import com.neon.arena.transport.GameConnection;
import com.neon.arena.weapon.WeaponDefinition;
import com.neon.arena.weapon.WeaponRegistry;
import com.neon.arena.weapon.WeaponSlot;
import com.neon.arena.skin.SkinRegistry;
import com.neon.arena.skin.SkinEquipmentService;
import com.neon.arena.map.MapRuntime;

import java.util.*;
import java.util.concurrent.*;

@Component
public class GameRoom {
    private static final long TICK_MS = 50;
    private static final long RESPAWN_DELAY_MS = 3_000;
    private final ObjectMapper json;
    private final WeaponRegistry weaponRegistry;
    private final SkinRegistry skinRegistry;
    private final SkinEquipmentService skinEquipmentService;
    private final MapRuntime mapRuntime;
    private final MatchController matchController;
    private final DamageResolver damageResolver;
    private final GameModeRules modeRules;
    private final ShotDirectionResolver shotDirectionResolver=new ShotDirectionResolver();
    private final java.util.random.RandomGenerator spreadRandom=new java.util.SplittableRandom();
    private final String buildVersion;
    private final String roomId;
    private final BotSettings botSettings;
    private final Queue<GameCommand> commands = new ConcurrentLinkedQueue<>();
    private final Map<String, GameConnection> sessions = new HashMap<>();
    private final Map<String, Player> players = new HashMap<>();
    private final Map<String, WorldItem> items = new LinkedHashMap<>();
    private final Map<Long,GrenadeState> grenades=new LinkedHashMap<>();
    private final Map<Long,SmokeState> smokes=new LinkedHashMap<>();
    private final Map<String,BotAgent> bots=new LinkedHashMap<>();
    private BotDifficulty botDifficulty=BotDifficulty.HARD;
    private long nextGrenadeId;
    private long nextDroppedWeaponId;
    private long tickCount;
    private long lastTickMicros;
    private volatile int maxHumanPlayers=12,maxSpectators=4;
    private volatile RoomStatus roomStatus=new RoomStatus(0,0,0,0,0,0,0,"WAITING",0,0,0,0);
    private long telemetryWindowStartedAt=System.currentTimeMillis(),telemetryMaxTickMicros,telemetryOverruns,outboundChars;
    private volatile long exportedMaxTickMicros,exportedOverruns;
    private volatile int outboundKiBps,lastSnapshotChars;
    private final ScheduledExecutorService loop;
    private boolean started;

    private static final class BotAgent {
        final Player player;
        long inputSequence;
        long shotSequence;
        long nextShotAt;
        long engageAt;
        long movementSampleAt;
        long avoidanceUntil;
        final double strafeDirection;
        double avoidanceDirection;
        double sampledX;
        double sampledZ;
        BotAgent(Player player,int index){
            this.player=player;
            this.strafeDirection=index%2==0?1:-1;
            this.avoidanceDirection=this.strafeDirection;
            this.sampledX=player.x;
            this.sampledZ=player.z;
            this.movementSampleAt=System.currentTimeMillis()+650;
            this.engageAt=System.currentTimeMillis();
        }
    }

    private ScheduledExecutorService createLoop() {
        return Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "arena-room-" + roomId);
        t.setDaemon(true);
        return t;
        });
    }

    @Autowired
    public GameRoom(ObjectMapper json, WeaponRegistry weaponRegistry, SkinRegistry skinRegistry,
                    SkinEquipmentService skinEquipmentService, MapRuntime mapRuntime,
                    MatchController matchController,
                    DamageResolver damageResolver,
                    GameModeRules modeRules,
                    @Value("${neon.version:dev}") String buildVersion,
                    @Value("${game.default-room:polygon-arena}") String roomId,
                    BotSettings botSettings) {
        this(json, weaponRegistry, skinRegistry, skinEquipmentService, mapRuntime, matchController,
            damageResolver, modeRules, buildVersion, roomId, true, botSettings);
    }

    /** RoomManager 使用同一套依赖创建第二个官方房间；房间状态仍完全独立。 */
    public GameRoom(ObjectMapper json, WeaponRegistry weaponRegistry, SkinRegistry skinRegistry,
                    SkinEquipmentService skinEquipmentService, MapRuntime mapRuntime,
                    MatchController matchController, DamageResolver damageResolver,
                    GameModeRules modeRules, String buildVersion, String roomId, boolean manual) {
        this(json,weaponRegistry,skinRegistry,skinEquipmentService,mapRuntime,matchController,damageResolver,
            modeRules,buildVersion,roomId,manual,new BotSettings(true,3,1_800,300,420,1.25,.82,20,24,1_500));
    }

    public GameRoom(ObjectMapper json, WeaponRegistry weaponRegistry, SkinRegistry skinRegistry,
                    SkinEquipmentService skinEquipmentService, MapRuntime mapRuntime,
                    MatchController matchController, DamageResolver damageResolver,
                    GameModeRules modeRules, String buildVersion, String roomId, boolean manual,
                    BotSettings botSettings) {
        this.json = json;
        this.weaponRegistry = weaponRegistry;
        this.skinRegistry = skinRegistry;
        this.skinEquipmentService = skinEquipmentService;
        this.mapRuntime = mapRuntime;
        this.matchController = matchController;
        this.damageResolver = damageResolver;
        this.modeRules = modeRules;
        this.buildVersion = resolveBuildVersion(buildVersion);
        this.roomId = roomId;
        this.botSettings=botSettings;
        this.loop = createLoop();
        mapRuntime.items().forEach(item->{WorldItemType type=WorldItemType.parse(item.itemType());items.put(item.id(),
            new WorldItem(item.id(),item.weaponId(),type,item.x(),item.z(),item.respawnMinMs(),item.respawnMaxMs()));});
    }

    public String roomId() { return roomId; }

    /**
     * Local development passes an explicit version. A production systemd launch intentionally
     * keeps its environment file across upgrades, so the packaged JAR manifest is the reliable
     * fallback and cannot become stale between releases.
     */
    static String resolveBuildVersion(String configured) {
        if (configured != null && !configured.isBlank() && !"dev".equalsIgnoreCase(configured)) return configured;
        String packaged = GameRoom.class.getPackage().getImplementationVersion();
        return packaged == null || packaged.isBlank() ? "dev" : packaged;
    }

    public MapRuntime mapRuntime() { return mapRuntime; }
    public record RoomStatus(int connections,int players,int spectators,int bots,int capacity,long tickMicros,int queueDepth,String phase,
                             long maxTickMicros,long tickOverruns,int outboundKiBps,int snapshotChars) {}
    public RoomStatus roomStatus(){return roomStatus;}
    public void configureCapacity(int players,int spectators){maxHumanPlayers=Math.max(1,players);maxSpectators=Math.max(0,spectators);}
    boolean botsEnabled(){return botSettings.enabled()&&botDifficulty.enabled();}
    int minimumCombatants(){return botSettings.minimumCombatants();}

    public void submit(GameCommand command) {
        commands.offer(command);
    }

    @PostConstruct
    void start() {
        if(started)return;started=true;
        loop.scheduleAtFixedRate(this::tick, 0, TICK_MS, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void stop() {
        started=false;
        loop.shutdownNow();
    }

    /**
     * 房间采用固定 20 Tick/s。命令消费和世界更新都在同一个房间线程执行，
     * 因此玩家、连接和道具状态不需要在每次修改时单独加锁。
     */
    private void tick() {
        long started = System.nanoTime();
        try {
            // 先结算上一 Tick 已到期的动作，再消费本 Tick 命令。否则换弹结束边界上
            // 到达的 shoot 会看到旧弹药并被无意义地拒绝一帧。
            finishWeaponActions();
            drainCommands();
            maintainBots();
            updateMatch();
            updateBots();
            if(matchController.movementEnabled())updateMovement();
            if(matchController.combatEnabled())updateGrenades();
            updateSmokes();
            respawnItems();
            // Combat remains authoritative at 20 Hz, while snapshots are sent at 10 Hz.
            // Hits, shots, kills and phase changes are still immediate events. This halves
            // JSON parsing and downstream bandwidth without slowing local predicted movement.
            if((tickCount&1)==0)broadcastState();
            tickCount++;
        } catch (Throwable error) {
            error.printStackTrace();
        } finally {
            lastTickMicros = (System.nanoTime() - started) / 1_000;
            telemetryMaxTickMicros=Math.max(telemetryMaxTickMicros,lastTickMicros);if(lastTickMicros>TICK_MS*1_000)telemetryOverruns++;
            rollTelemetryWindow();
            refreshRoomStatus();
        }
    }

    private void rollTelemetryWindow(){
        long now=System.currentTimeMillis(),elapsed=now-telemetryWindowStartedAt;if(elapsed<1_000)return;
        exportedMaxTickMicros=telemetryMaxTickMicros;exportedOverruns=telemetryOverruns;
        outboundKiBps=(int)Math.round(outboundChars*1000.0/Math.max(1,elapsed)/1024.0);
        telemetryWindowStartedAt=now;telemetryMaxTickMicros=0;telemetryOverruns=0;outboundChars=0;
    }

    private void refreshRoomStatus(){
        int humans=0,spectators=0,botCount=0;
        for(Player player:players.values())if(player.joined){
            if(player.bot)botCount++;
            else if(player.spectator)spectators++;
            else humans++;
        }
        roomStatus=new RoomStatus(sessions.size(),humans,spectators,botCount,maxHumanPlayers,lastTickMicros,commands.size(),matchController.phase().name(),
            exportedMaxTickMicros,exportedOverruns,outboundKiBps,lastSnapshotChars);
    }

    /**
     * 网络线程是命令生产者，房间线程是唯一消费者。
     * 每个 Tick 开始时按入队顺序处理命令，保证切枪、换弹和射击的顺序稳定。
     */
    private void drainCommands() {
        for (GameCommand command; (command = commands.poll()) != null; ) {
            if (command instanceof GameCommand.Connect c) connect(c.connection());
            else if (command instanceof GameCommand.Disconnect d) disconnect(d.connectionId());
            else if (command instanceof GameCommand.Message m) handle(m.connectionId(), m.payload());
        }
    }

    private void connect(GameConnection session) {
        sessions.put(session.id(), session);
        Player player = new Player(session.id(), weaponRegistry.require("m4a1"),mapRuntime.randomSpawn());
        grantMelee(player);
        skinRegistry.defaultOwnedSkinIds().forEach(player::grantSkin);
        equipDefaultSkin(player,weaponRegistry.require("m4a1"));
        players.put(player.id, player);
        ObjectNode welcome = json.createObjectNode().put("type", "welcome").put("id", player.id).put("version", buildVersion).put("roomId",roomId)
            .put("mapId",mapRuntime.id()).put("mapRevision",mapRuntime.revision()).put("mapContentHash",mapRuntime.contentHash());
        welcome.set("player", playerJson(player));
        welcome.set("weaponCatalog", weaponRegistry.clientCatalog(json));
        welcome.set("skinCatalog", skinRegistry.clientCatalog(json));
        welcome.set("match",matchJson(System.currentTimeMillis()));
        ArrayNode ownedSkins=welcome.putArray("ownedSkinIds");player.ownedSkinIds.forEach(ownedSkins::add);
        send(session, welcome);
    }

    private void disconnect(String id) {
        Player player = players.remove(id);
        sessions.remove(id);
        if (player != null && player.joined)
            system((player.spectator ? "观战者 " : "玩家 ") + player.name + " 离开了竞技场");
    }

    /** Empty rooms own no bots. Once a human joins, fill only the missing combatant slots. */
    private void maintainBots(){
        if(!botSettings.enabled()||!botDifficulty.enabled()){
            bots.keySet().forEach(players::remove);bots.clear();return;
        }
        long humans=players.values().stream().filter(player->player.joined&&!player.spectator&&!player.bot).count();
        // MVP only assists a solo player. As soon as a second human joins, bots leave
        // so real duels and automated multiplayer checks are not polluted by AI fire.
        int desired=humans==1?Math.max(0,botSettings.minimumCombatants()-1):0;
        while(bots.size()>desired){String id=bots.keySet().stream().reduce((first,second)->second).orElseThrow();bots.remove(id);players.remove(id);}
        for(int index=0;bots.size()<desired;index++){
            String id="bot:"+roomId+":"+index;if(bots.containsKey(id))continue;
            Player bot=new Player(id,weaponRegistry.require("m4a1"),safeBotSpawn());bot.bot=true;bot.joined=true;bot.name=botDifficultyLabel()+"机器人 "+(index+1);skinRegistry.defaultOwnedSkinIds().forEach(bot::grantSkin);equipDefaultSkin(bot,weaponRegistry.require("m4a1"));long now=System.currentTimeMillis();readyBot(bot,now);BotAgent agent=new BotAgent(bot,index);agent.nextShotAt=now+botDifficulty.reactionMs();agent.engageAt=now+botSettings.spawnHoldMs();bots.put(id,agent);players.put(id,bot);
        }
    }

    private void readyBot(Player bot,long now){bot.spawnBuff=SpawnBuff.NONE;bot.spawnBuffSelected=true;bot.spawnBuffSelectionUntil=now;bot.spawnBuffUntil=0;bot.invulnerableUntil=now+750;}

    /**
     * Bots produce the same PlayerInput and shoot intent as a client. Collision, ammo, spread,
     * obstruction, damage and scoring remain inside the normal authoritative room pipeline.
     */
    private void updateBots(){
        if(bots.isEmpty())return;long now=System.currentTimeMillis();
        for(BotAgent agent:bots.values()){
            Player bot=agent.player;
            if(!bot.alive){if(matchController.combatEnabled()&&now>=bot.respawnAvailableAt){bot.respawn(safeBotSpawn());readyBot(bot,now);agent.nextShotAt=now+botDifficulty.reactionMs();agent.engageAt=now+botSettings.spawnHoldMs();}continue;}
            if(!matchController.movementEnabled()){bot.input=PlayerInput.idle(bot.yaw,bot.pitch);continue;}
            if(now<agent.engageAt){bot.input=PlayerInput.idle(bot.yaw,bot.pitch);continue;}
            if(now<bot.blindedUntil){bot.input=PlayerInput.idle(bot.yaw,bot.pitch);continue;}
            Player target=players.values().stream().filter(value->value!=bot&&value.joined&&!value.spectator&&value.alive)
                .min(Comparator.comparingDouble(value->Math.hypot(value.x-bot.x,value.z-bot.z))).orElse(null);
            if(target==null){bot.input=PlayerInput.idle(bot.yaw,bot.pitch);continue;}
            double dx=target.x-bot.x,dz=target.z-bot.z,distance=Math.hypot(dx,dz),yaw=Math.atan2(-dx,-dz),pitch=clamp(Math.atan2((target.y+botDifficulty.aimHeightOffset())-bot.y,Math.max(.01,distance)),-.7,.7);
            boolean obscured=smokeBlocksSight(bot.x,bot.y,bot.z,target.x,target.y-.7,target.z);
            double wobble=Math.sin((now+bot.id.hashCode()*31L)/430.0)*botDifficulty.aimErrorRadians();bot.yaw=yaw+wobble;bot.pitch=pitch+wobble*.45;
            MapRuntime.NavigationWaypoint waypoint=mapRuntime.nextNavigationWaypoint(bot.x,bot.z,target.x,target.z);
            double moveDx=waypoint==null?dx:waypoint.x()-bot.x,moveDz=waypoint==null?dz:waypoint.z()-bot.z;
            double moveDistance=Math.hypot(moveDx,moveDz);
            double[] movement=botMovement(agent,moveDx,moveDz,moveDistance,distance,waypoint!=null,now);
            double sin=Math.sin(bot.yaw),cos=Math.cos(bot.yaw);
            double forward=-sin*movement[0]-cos*movement[1];
            double right=cos*movement[0]-sin*movement[1];
            bot.input=new PlayerInput(++agent.inputSequence,forward,right,false,bot.yaw,bot.pitch);
            if(!obscured&&matchController.scoringEnabled()&&now>=agent.nextShotAt&&distance<32&&bot.weaponAction==WeaponAction.READY){ObjectNode shot=json.createObjectNode().put("shotId",++agent.shotSequence).put("aimYaw",bot.yaw).put("aimPitch",bot.pitch);shoot(bot,shot);agent.nextShotAt=now+nextBotShotDelay();}
        }
    }

    /**
     * Lightweight local steering keeps training bots useful without introducing a nav-mesh.
     * The returned vector is in world X/Z space and is converted to normal player input above.
     */
    private double[] botMovement(BotAgent agent,double targetDx,double targetDz,double distance,
                                 double combatDistance,boolean routing,long now){
        Player bot=agent.player;
        double inv=1/Math.max(.01,distance),towardX=targetDx*inv,towardZ=targetDz*inv;
        double moveX,moveZ;
        if(routing){moveX=towardX;moveZ=towardZ;}
        else if(distance>7){moveX=towardX;moveZ=towardZ;}
        else if(distance<3.8){moveX=-towardX*.55;moveZ=-towardZ*.55;}
        else {moveX=-towardZ*agent.strafeDirection*.48;moveZ=towardX*agent.strafeDirection*.48;}

        if(now>=agent.movementSampleAt){
            double travelled=Math.hypot(bot.x-agent.sampledX,bot.z-agent.sampledZ);
            if(combatDistance>5&&travelled<.18){
                agent.avoidanceDirection=-agent.avoidanceDirection;
                agent.avoidanceUntil=now+1_100;
                if(bot.onGround)bot.jumpQueued=true;
            }
            agent.sampledX=bot.x;agent.sampledZ=bot.z;agent.movementSampleAt=now+650;
        }

        double moveLength=Math.hypot(moveX,moveZ);
        if(moveLength>.01){
            double probeX=moveX/moveLength,probeZ=moveZ/moveLength;
            MapRuntime.RayHit obstacle=mapRuntime.firstObstacleHit(
                bot.x,bot.y-.72,bot.z,probeX,0,probeZ,1.65);
            if(obstacle.hit())agent.avoidanceUntil=Math.max(agent.avoidanceUntil,now+850);
            if(now<agent.avoidanceUntil){
                double sideX=-probeZ*agent.avoidanceDirection,sideZ=probeX*agent.avoidanceDirection;
                MapRuntime.RayHit sideObstacle=mapRuntime.firstObstacleHit(
                    bot.x,bot.y-.72,bot.z,sideX,0,sideZ,1.15);
                if(sideObstacle.hit()){
                    agent.avoidanceDirection=-agent.avoidanceDirection;
                    sideX=-sideX;sideZ=-sideZ;
                }
                moveX=sideX*.9+towardX*.2;
                moveZ=sideZ*.9+towardZ*.2;
            }
        }
        double length=Math.hypot(moveX,moveZ);
        if(length>1){moveX/=length;moveZ/=length;}
        return new double[]{moveX*botDifficulty.movementScale(),moveZ*botDifficulty.movementScale()};
    }

    /** Pick the least exposed sampled spawn, preferring both human distance and hard cover. */
    private double[] safeBotSpawn(){
        List<Player> humans=players.values().stream()
            .filter(player->player.joined&&!player.spectator&&!player.bot&&player.alive).toList();
        if(humans.isEmpty())return mapRuntime.randomSpawn();
        double[] best=null;double bestScore=Double.NEGATIVE_INFINITY;
        for(int index=0;index<botSettings.spawnCandidateCount();index++){
            double[] candidate=mapRuntime.randomSpawn();
            double nearest=Double.POSITIVE_INFINITY;boolean visible=false;
            for(Player human:humans){
                double dx=human.x-candidate[0],dz=human.z-candidate[1],distance=Math.hypot(dx,dz);
                nearest=Math.min(nearest,distance);
                if(distance>.2&&!mapRuntime.firstObstacleHit(candidate[0],MapRuntime.EYE_HEIGHT,candidate[1],
                    dx/distance,0,dz/distance,Math.max(.05,distance-.3)).hit())visible=true;
            }
            // Prefer a covered mid-distance spawn. Extremely distant points are valid fallbacks,
            // but should not make the player spend half a minute searching for the training bot.
            double preferred=botSettings.safeSpawnDistance()+10;
            double score=100-Math.abs(nearest-preferred)*.6-(visible?12:0);
            if(nearest<botSettings.safeSpawnDistance())score-=200+(botSettings.safeSpawnDistance()-nearest)*10;
            double nearestBot=players.values().stream().filter(player->player.bot&&player.alive)
                .mapToDouble(player->Math.hypot(player.x-candidate[0],player.z-candidate[1]))
                .min().orElse(Double.POSITIVE_INFINITY);
            if(nearestBot<4)score-=(4-nearestBot)*8;
            if(score>bestScore){best=candidate;bestScore=score;}
        }
        return best!=null?best:mapRuntime.randomSpawn();
    }

    private long nextBotShotDelay(){
        long min=botDifficulty.shotMinMs(),max=botDifficulty.shotMaxMs();
        return min==max?min:spreadRandom.nextLong(min,max+1);
    }

    private String botDifficultyLabel(){return switch(botDifficulty){case EASY->"简单";case HARD->"困难";case INFERNO->"炼狱";case OFF->"关闭";};}

    private void handle(String id, JsonNode message) {
        Player player = players.get(id);
        if (player == null) return;
        switch (message.path("type").asText()) {
            case "join" -> join(player, message.path("name").asText("玩家"),
                message.path("spectator").asBoolean(false));
            case "select_spawn_buff" -> selectSpawnBuff(player, message.path("buff").asText(null));
            case "leave" -> leave(player);
            case "input" -> input(player, message);
            case "shoot" -> shoot(player, message);
            case "equip_throwable" -> equipThrowable(player,true);
            case "unequip_throwable" -> equipThrowable(player,false);
            case "throw_grenade" -> throwGrenade(player,message);
            case "configure_bots" -> configureBots(player,message.path("difficulty").asText("HARD"));
            case "reload" -> reload(player);
            case "switch_weapon" -> switchWeapon(player, message.path("weapon").asText());
            case "equip_skin" -> equipSkin(player, message.path("weapon").asText(null), message.path("skinId").asText());
            case "scope" -> scope(player, message.path("active").asBoolean());
            case "pickup" -> pickup(player, message.path("itemId").asText());
            case "chat" -> chat(player, message.path("text").asText());
            case "respawn" -> respawn(player);
            case "ping" -> send(sessions.get(player.id), json.createObjectNode().put("type", "pong").put("clientTime", message.path("clientTime").asLong()));
        }
    }

    /** The held throwable is authoritative because it changes movement speed. */
    private void equipThrowable(Player player,boolean equipped){
        if(!player.joined||player.spectator||!player.alive)return;
        if(equipped&&player.throwableInventory.values().stream().noneMatch(count->count>0))return;
        if(equipped&&player.weaponAction!=WeaponAction.READY&&System.currentTimeMillis()<player.weaponActionUntil)return;
        player.holdingThrowable=equipped;
        if(equipped)player.scoped=false;
    }

    /** Solo training control. Shared multiplayer rooms reject client-owned rule changes. */
    private void configureBots(Player requester,String requested){
        if(!requester.joined||requester.spectator||requester.bot)return;
        long humans=players.values().stream().filter(player->player.joined&&!player.spectator&&!player.bot).count();
        if(humans>1){send(sessions.get(requester.id),json.createObjectNode().put("type","bot_config_rejected").put("reason","multiplayer"));return;}
        botDifficulty=BotDifficulty.parse(requested);long now=System.currentTimeMillis();
        int index=1;for(BotAgent agent:bots.values()){agent.player.name=botDifficultyLabel()+"机器人 "+index++;agent.nextShotAt=now+botDifficulty.reactionMs();}
        send(sessions.get(requester.id),json.createObjectNode().put("type","bot_configured").put("difficulty",botDifficulty.name()));
    }

    private void join(Player player, String name, boolean spectator) {
        player.name = cleanName(name);
        if (!player.joined) {
            long current=players.values().stream().filter(value->value.joined&&!value.bot&&(spectator?value.spectator:!value.spectator)).count();
            int capacity=spectator?maxSpectators:maxHumanPlayers;
            if(current>=capacity){
                send(sessions.get(player.id),json.createObjectNode().put("type","join_rejected")
                    .put("reason",spectator?"spectator_full":"room_full").put("roomId",roomId)
                    .put("current",current).put("capacity",capacity));
                return;
            }
            player.spectator = spectator;
            // 观战者只消费世界快照，不生成可命中角色。保留 Player 对象是为了复用连接、
            // 聊天和离开房间生命周期，后续多房间切换也无需维护第二套会话模型。
            if (spectator) { player.alive = false; player.spawnBuffSelectionUntil = 0; }
            else player.respawn(mapRuntime.randomSpawn(),true);
            player.joined = true;
            system((spectator ? "观战者 " : "玩家 ") + player.name
                + (spectator ? " 进入观战" : " 进入了竞技场"));
            ObjectNode spawn = json.createObjectNode().put("type", "spawn");
            spawn.set("player", playerJson(player));
            send(sessions.get(player.id), spawn);
        }
    }

    /**
     * 出生 Buff 只能在本次出生的无敌窗口内选择一次。客户端无法延长窗口、重复换 Buff，
     * TEAM_DEATHMATCH 即使收到伪造消息也会在模式入口直接拒绝。
     */
    private void selectSpawnBuff(Player player, String requestedBuff) {
        long now = System.currentTimeMillis();
        SpawnBuff buff = SpawnBuff.parse(requestedBuff);
        if (!modeRules.buffsEnabled() || !player.joined || player.spectator
            || !player.selectSpawnBuff(buff, now)) return;
        ObjectNode event = json.createObjectNode().put("type", "buff_selected");
        event.set("player", playerJson(player));
        send(sessions.get(player.id), event);
    }

    private boolean awaitingSpawnChoice(Player player,long now) {
        return modeRules.buffsEnabled() && !player.spawnBuffSelected
            && now < player.spawnBuffSelectionUntil;
    }

    /**
     * 返回大厅时保留 WebSocket 连接，只把玩家从当前战斗名单移出。再次加入会复用
     * 同一连接，避免为了切换界面重新建立 Netty/Spring WebSocket。
     */
    private void leave(Player player) {
        if (!player.joined) return;
        boolean wasSpectator = player.spectator;
        player.joined = false;
        player.scoped = false;
        player.input = PlayerInput.idle();
        player.kills = 0;
        player.deaths = 0;
        player.spectator = false;
        player.respawn(mapRuntime.randomSpawn());
        system((wasSpectator ? "观战者 " : "玩家 ") + player.name + " 离开了竞技场");
    }

    /**
     * 输入消息只更新玩家的最新操作状态。真正的位置计算统一放在 updateMovement，
     * 从而保证无论客户端帧率高低，服务端都按固定 Tick 推进世界。
     */
    private void input(Player p, JsonNode message) {
        if (!matchController.movementEnabled() || !p.alive || !p.joined || p.spectator) return;
        long sequence = message.path("sequence").asLong();
        if (sequence <= p.input.sequence()) return;
        double forward = clamp(message.path("forward").asDouble(), -1, 1);
        double right = clamp(message.path("right").asDouble(), -1, 1);
        p.input = new PlayerInput(sequence, forward, right, message.path("sprint").asBoolean(),
            message.path("yaw").asDouble(), clamp(message.path("pitch").asDouble(), -1.45, 1.45));
        if (message.path("jump").asBoolean()) p.jumpQueued = true;
    }

    /**
     * 服务端权威移动：根据最新输入、固定时间步长和服务端地图计算位置。
     * X/Z 分轴检测允许玩家贴墙滑动；跳跃使用垂直速度和重力模拟。
     */
    private void updateMovement() {
        double dt = TICK_MS / 1000.0;
        for (Player p : players.values()) {
            if (!p.joined || !p.alive || p.spectator) continue;
            PlayerInput input = p.input;
            p.yaw = input.yaw();
            p.pitch = input.pitch();
            double forward = input.forward(), right = input.right();
            double length = Math.hypot(forward, right);
            if (length > 1) { forward /= length; right /= length; }
            WeaponDefinition heldWeapon=weaponRegistry.require(p.currentWeapon);
            double equipmentMultiplier=p.holdingThrowable?1.06:heldWeapon.movementMultiplier();
            double speed = (input.sprint() ? 9 : 6)*equipmentMultiplier;
            if (p.hasActiveSpawnBuff(System.currentTimeMillis()) && p.spawnBuff == SpawnBuff.FEARLESS) speed *= 1.25;
            if(System.currentTimeMillis()<p.speedBoostUntil)speed*=1.20;
            double dx = (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * right) * speed * dt;
            double dz = (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * right) * speed * dt;
            moveHorizontalAxis(p, p.x + dx, p.z, true);
            moveHorizontalAxis(p, p.x, p.z + dz, false);
            if (p.jumpQueued && p.onGround) { p.verticalVelocity = System.currentTimeMillis()<p.speedBoostUntil?11.25:8; p.onGround = false; }
            p.jumpQueued = false;
            p.verticalVelocity -= 20 * dt;
            MapRuntime.VerticalMove vertical = mapRuntime.resolveVertical(
                p.x, p.z, p.y, p.verticalVelocity, dt);
            p.y = vertical.eyeY();
            p.verticalVelocity = vertical.verticalVelocity();
            p.onGround = vertical.onGround();
            p.lastProcessedInput = input.sequence();
        }
    }

    /**
     * 分轴移动仍保留贴墙滑动，但落地玩家会先查询目标点的脚底高度。目标表面不高于
     * STEP_HEIGHT 时可自然踏上平台或沿坡上行；超过台阶能力的 solid 平台仍由 AABB 侧面阻挡。
     */
    private void moveHorizontalAxis(Player p, double targetX, double targetZ, boolean xAxis) {
        double candidateEyeY = p.y;
        if (p.onGround) {
            double feetY = p.y - MapRuntime.EYE_HEIGHT;
            MapRuntime.GroundHit ground = mapRuntime.groundHeight(
                targetX, targetZ, feetY, MapRuntime.STEP_HEIGHT, MapRuntime.GROUND_SNAP);
            if (ground.hit()) candidateEyeY = ground.height() + MapRuntime.EYE_HEIGHT;
        }
        if (mapRuntime.collides(targetX, candidateEyeY, targetZ)) return;
        if (xAxis) p.x = targetX; else p.z = targetZ;
        p.y = candidateEyeY;
    }

    /**
     * 服务端权威射击流程：验证武器状态，以服务端坐标创建射线，
     * 计算射线与玩家碰撞体的距离，并只对最近目标结算伤害。
     * 墙体遮挡与随机散布均由服务端计算；历史帧回溯仍属于后续网络优化。
     */
    private void shoot(Player shooter, JsonNode m) {
        long now = System.currentTimeMillis();
        WeaponDefinition weapon = weaponRegistry.require(shooter.currentWeapon);
        long shotId=m.path("shotId").asLong();
        if (!matchController.combatEnabled() || !shooter.alive || !shooter.joined || shooter.spectator
            || awaitingSpawnChoice(shooter,now)) return;
        if(shotId<=shooter.lastShotRequestId){rejectShot(shooter,shotId,"replay",0);return;}
        shooter.lastShotRequestId=shotId;
        if (now < shooter.jammedUntil) {
            rejectShot(shooter,shotId,"buff_jammed",shooter.jammedUntil-now); return;
        }
        if (shooter.weaponAction != WeaponAction.READY && now < shooter.weaponActionUntil) {
            rejectShot(shooter,shotId, shooter.weaponAction.name().toLowerCase(), shooter.weaponActionUntil - now); return;
        }
        long cooldownRemaining = weapon.fireIntervalMs() - (now - shooter.lastShot);
        if (cooldownRemaining > 0) { rejectShot(shooter,shotId,"cooldown", cooldownRemaining); return; }
        if (weapon.melee()) { meleeAttack(shooter, weapon, shotId, m, now); return; }
        if (shooter.ammo() <= 0) { rejectShot(shooter,shotId,"no_ammo", 0); return; }
        double aimYaw=m.path("aimYaw").asDouble(shooter.yaw),aimPitch=m.path("aimPitch").asDouble(shooter.pitch);
        if(!Double.isFinite(aimYaw)||!Double.isFinite(aimPitch)){rejectShot(shooter,shotId,"direction",0);return;}
        double cosPitch = Math.cos(aimPitch);
        double expectedCosPitch=Math.cos(shooter.pitch);
        double expectedX = -Math.sin(shooter.yaw) * expectedCosPitch;
        double expectedY = Math.sin(shooter.pitch);
        double expectedZ = -Math.cos(shooter.yaw) * expectedCosPitch;
        double aimX=-Math.sin(aimYaw)*cosPitch,aimY=Math.sin(aimPitch),aimZ=-Math.cos(aimYaw)*cosPitch;
        double directionDot = aimX * expectedX + aimY * expectedY + aimZ * expectedZ;
        // aimYaw/aimPitch 由客户端提交，但只能在最近一次服务器视角附近；随机散布不再
        // 接受客户端 dx/dy/dz，避免修改浏览器脚本即可把 AK 或 M4 变成无散布武器。
        if (directionDot < .94) { rejectShot(shooter,shotId,"direction", 0); return; }
        boolean moving=Math.abs(shooter.input.forward())>.01||Math.abs(shooter.input.right())>.01;
        boolean scopeReady=shooter.scoped&&now-shooter.scopedAt>=weapon.aimInMs();
        double heat=shooter.weaponState().consumeShotHeat(weapon,now);
        double spread=(scopeReady?weapon.aimedSpread():weapon.hipSpread())*(1+heat)*(moving?1.35:1);
        ShotDirectionResolver.Direction direction=shotDirectionResolver.resolve(aimYaw,aimPitch,spread,spreadRandom);
        double ox = shooter.x, oy = shooter.y, oz = shooter.z, dx=direction.x(),dy=direction.y(),dz=direction.z();
        shooter.lastShot = now;
        // consumeRound 再次保护弹匣下界。即使以后不同网络入口并发提交 shoot，
        // 房间线程也只会让有效射击把弹药从 1 扣到 0，不会产生负数。
        if (!shooter.weaponState().consumeRound()) { rejectShot(shooter,shotId,"no_ammo", 0); return; }
        // 栓动狙击枪在有效射击后由服务端同步退出开镜。客户端会立即播放退镜，
        // 这里保存权威状态，避免延迟或篡改客户端仍把玩家标记为 scoped。
        if (!weapon.retainScopeAfterShot()){shooter.scoped = false;shooter.scopedAt=0;}
        // 无限备弹模式下，最后一发射出后由服务端自动开始换弹。
        // 换弹仍采用完成时间而非阻塞等待，finishReloads 会在后续 Tick 补满弹匣。
        if (shooter.ammo() == 0) beginReload(shooter,weapon);
        else if (weapon.cycleTimeMs() > 0) beginAction(shooter,WeaponAction.CYCLING,weapon.cycleTimeMs());
        Player hit = null;
        boolean headshot = false;
        MapRuntime.RayHit obstacleHit=mapRuntime.firstObstacleHit(ox,oy,oz,dx,dy,dz,weapon.maxRange());
        double wallDistance = obstacleHit.distance();
        double best = wallDistance;
        for (Player target : players.values())
            if (target != shooter && target.joined && !target.spectator
                && target.alive && now >= target.invulnerableUntil) {
                double tx = target.x - ox, ty = (target.y - .7) - oy, tz = target.z - oz, t = tx * dx + ty * dy + tz * dz;
                if (t > 0 && t < best) {
                    double px = tx - dx * t, py = ty - dy * t, pz = tz - dz * t;
                    if (px * px + py * py + pz * pz < .75) {
                        hit = target;
                        best = t;
                        headshot = oy + dy * t > target.y - .35;
                    }
                }
            }
        String impact = hit != null ? "player" : (wallDistance < weapon.maxRange() ? "wall" : "none");
        ObjectNode shot = json.createObjectNode().put("type", "shot").put("id", shooter.id).put("shotId",shotId).put("weapon", weapon.id()).put("impact", impact).put("ox", ox).put("oy", oy).put("oz", oz).put("dx", dx).put("dy", dy).put("dz", dz).put("distance", Math.min(best, 45));
        if("wall".equals(impact)){
            shot.put("colliderId",obstacleHit.colliderId()).put("surface",obstacleHit.surface());
            shot.putArray("hitPoint").add(obstacleHit.point().x()).add(obstacleHit.point().y()).add(obstacleHit.point().z());
            shot.putArray("normal").add(obstacleHit.normal().x()).add(obstacleHit.normal().y()).add(obstacleHit.normal().z());
        }
        broadcast(shot);
        ObjectNode result=json.createObjectNode().put("type","shot_result").put("shotId",shotId)
            .put("outcome",hit!=null?ShotOutcome.HIT.name():(wallDistance<weapon.maxRange()?ShotOutcome.BLOCKED.name():ShotOutcome.MISS.name()))
            .put("serverTick",tickCount).put("impact",impact).put("spread",spread)
            .put("moving",moving).put("scopeReady",scopeReady).put("directionDot",directionDot)
            .put("wallDistance",wallDistance).put("dx",dx).put("dy",dy).put("dz",dz);
        if (hit != null) {
            // FFA Buff 在服务端已经确定命中候选后判定，并把结果返回攻击者，避免
            // “视觉打中但无伤害”被误认为丢包或命中系统错误。
            if (hit.hasActiveSpawnBuff(now) && hit.spawnBuff == SpawnBuff.LEFT_TRAJECTORY
                && spreadRandom.nextDouble() < .35) {
                result.put("outcome", ShotOutcome.DEFLECTED.name()).put("target", hit.id)
                    .put("buff", hit.spawnBuff.name());
                send(sessions.get(shooter.id), result);
                notifyBuffTriggered(hit,shooter,hit.spawnBuff,ShotOutcome.DEFLECTED);
                return;
            }
            if (hit.hasActiveSpawnBuff(now) && hit.spawnBuff == SpawnBuff.NO_AMMO
                && spreadRandom.nextDouble() < .35) {
                shooter.jammedUntil = now + 1_200;
                result.put("outcome", ShotOutcome.JAMMED.name()).put("target", hit.id)
                    .put("buff", hit.spawnBuff.name());
                send(sessions.get(shooter.id), result);
                notifyBuffTriggered(hit,shooter,hit.spawnBuff,ShotOutcome.JAMMED);
                return;
            }
            applyWeaponHit(shooter,hit,weapon,best,headshot,now,result);
        }
        send(sessions.get(shooter.id),result);
    }

    /** 枪械与近战共用的伤害、受击通知和击杀结算，保证两种攻击的计分规则完全一致。 */
    private void applyWeaponHit(Player shooter,Player hit,WeaponDefinition weapon,double best,boolean headshot,long now,ObjectNode result){
        DamageResolver.Result resolution=damageResolver.resolve(weapon,best,headshot,hit.hp,hit.armor);
        int dealtDamage = resolution.dealtDamage();
        hit.armor=resolution.remainingArmor();
        hit.hp=resolution.remainingHealth();
        result.put("target",hit.id).put("part",headshot?"head":"body").put("damage",dealtDamage);
        ObjectNode damageTaken=json.createObjectNode().put("type","damage_taken")
            .put("attackerId",shooter.id).put("attacker",shooter.name)
            .put("weapon",weapon.id()).put("damage",dealtDamage)
            .put("remainingHp",hit.hp).put("remainingArmor",hit.armor)
            .put("distance",Math.round(best*10.0)/10.0)
            .put("sourceYaw",sourceYaw(hit,shooter)).put("headshot",headshot)
            .put("killed",hit.hp<=0);
        send(sessions.get(hit.id),damageTaken);
        if (hit.hp <= 0) {
            hit.hp = 0;
            hit.alive = false;
            hit.respawnAvailableAt=now+RESPAWN_DELAY_MS;
            if(matchController.scoringEnabled()){
                hit.deaths++;shooter.kills++;
                dropWeaponOnDeath(hit,now);
            }
            broadcast(json.createObjectNode().put("type", "kill")
                .put("killerId",shooter.id).put("killer", shooter.name)
                .put("victimId", hit.id).put("victim", hit.name)
                .put("weapon",weapon.id()).put("distance",Math.round(best*10.0)/10.0)
                .put("respawnDelayMs",RESPAWN_DELAY_MS)
                .put("headshot", headshot).put("counted",matchController.scoringEnabled()));
        }
        result.put("killed",hit.hp<=0);
    }

    static final double MELEE_BODY_RADIUS=.4;
    static final double MELEE_HALF_ANGLE_COS=Math.cos(Math.toRadians(35));

    /**
     * 近战轻击：从眼睛出发，在前方 maxRange（加身体半径）内、水平约 70° 扇形中寻找最近的目标，
     * 并要求挥砍高度落在目标身体范围内、两者之间没有墙体遮挡。贴身时放宽为整个正前方半球，
     * 避免"刀已经捅进身体却判定没打到"。命中与否都广播挥刀事件，供其他玩家播放动作与音效。
     */
    private void meleeAttack(Player shooter,WeaponDefinition weapon,long shotId,JsonNode m,long now){
        double aimYaw=m.path("aimYaw").asDouble(shooter.yaw),aimPitch=m.path("aimPitch").asDouble(shooter.pitch);
        if(!Double.isFinite(aimYaw)||!Double.isFinite(aimPitch)){rejectShot(shooter,shotId,"direction",0);return;}
        double expectedCos=Math.cos(shooter.pitch),aimCos=Math.cos(aimPitch);
        double directionDot=(-Math.sin(aimYaw)*aimCos)*(-Math.sin(shooter.yaw)*expectedCos)+Math.sin(aimPitch)*Math.sin(shooter.pitch)+(-Math.cos(aimYaw)*aimCos)*(-Math.cos(shooter.yaw)*expectedCos);
        if(directionDot<.94){rejectShot(shooter,shotId,"direction",0);return;}
        shooter.lastShot=now;shooter.scoped=false;shooter.scopedAt=0;
        double ox=shooter.x,oy=shooter.y,oz=shooter.z,fx=-Math.sin(aimYaw),fz=-Math.cos(aimYaw);
        double reach=weapon.maxRange()+MELEE_BODY_RADIUS,slope=Math.tan(Math.max(-1.3,Math.min(1.3,aimPitch)));
        Player hit=null;double best=Double.MAX_VALUE;
        for(Player target:players.values()){
            if(target==shooter||!target.joined||target.spectator||!target.alive||now<target.invulnerableUntil)continue;
            double hx=target.x-ox,hz=target.z-oz,horizontal=Math.hypot(hx,hz);
            if(horizontal>reach)continue;
            double facing=horizontal<1e-4?1:(hx*fx+hz*fz)/horizontal;
            if(facing<(horizontal<.6?0:MELEE_HALF_ANGLE_COS))continue;
            // 挥砍在目标水平距离处的高度必须落在身体（脚到头顶）附近。
            double swingY=oy+slope*horizontal,feet=target.y-MapRuntime.EYE_HEIGHT,head=target.y+.15;
            if(swingY<feet-.35||swingY>head+.35)continue;
            double cy=Math.max(feet+.3,Math.min(head-.1,swingY)),dy=cy-oy,distance=Math.sqrt(horizontal*horizontal+dy*dy);
            if(distance>1e-4){
                MapRuntime.RayHit wall=mapRuntime.firstObstacleHit(ox,oy,oz,hx/distance,dy/distance,hz/distance,distance);
                if(wall.distance()<distance-.05)continue;
            }
            if(distance<best){best=distance;hit=target;}
        }
        ObjectNode swing=json.createObjectNode().put("type","melee_swing").put("id",shooter.id).put("weapon",weapon.id()).put("hit",hit!=null);
        broadcast(swing);
        ObjectNode result=json.createObjectNode().put("type","shot_result").put("shotId",shotId).put("weapon",weapon.id())
            .put("serverTick",tickCount).put("melee",true).put("directionDot",directionDot);
        if(hit==null){
            double pc=Math.cos(aimPitch),dx=fx*pc,dy=Math.sin(aimPitch),dz=fz*pc;
            MapRuntime.RayHit wall=mapRuntime.firstObstacleHit(ox,oy,oz,dx,dy,dz,weapon.maxRange());
            boolean blocked=wall.distance()<weapon.maxRange();
            result.put("outcome",blocked?ShotOutcome.BLOCKED.name():ShotOutcome.MISS.name()).put("impact",blocked?"wall":"none");
            if(blocked){
                result.put("surface",wall.surface());
                result.putArray("hitPoint").add(wall.point().x()).add(wall.point().y()).add(wall.point().z());
                result.putArray("normal").add(wall.normal().x()).add(wall.normal().y()).add(wall.normal().z());
            }
            send(sessions.get(shooter.id),result);
            return;
        }
        result.put("outcome",ShotOutcome.HIT.name()).put("impact","player");
        applyWeaponHit(shooter,hit,weapon,best,false,now,result);
        send(sessions.get(shooter.id),result);
    }

    /** 每名玩家出生自带一把近战武器，放在 MELEE 槽位，不改变当前手持武器。 */
    private void grantMelee(Player player){
        if(weaponRegistry.contains("knife"))player.addWeapon(weaponRegistry.require("knife"));
    }

    private void notifyBuffTriggered(Player owner,Player attacker,SpawnBuff buff,ShotOutcome outcome){
        ObjectNode base=json.createObjectNode().put("type","buff_triggered")
            .put("buff",buff.name()).put("outcome",outcome.name())
            .put("ownerId",owner.id).put("owner",owner.name)
            .put("sourceId",attacker.id).put("source",attacker.name);
        ObjectNode ownerEvent=base.deepCopy().put("perspective","OWNER");
        ObjectNode attackerEvent=base.deepCopy().put("perspective","ATTACKER");
        send(sessions.get(owner.id),ownerEvent);
        send(sessions.get(attacker.id),attackerEvent);
    }

    /** World yaw whose forward vector points from the victim toward the attacker. */
    static double sourceYaw(Player victim,Player attacker){
        return Math.atan2(victim.x-attacker.x,victim.z-attacker.z);
    }

    static double sourceYaw(Player victim,double sourceX,double sourceZ){
        return Math.atan2(victim.x-sourceX,victim.z-sourceZ);
    }

    private void throwGrenade(Player player,JsonNode message){
        long now=System.currentTimeMillis();
        if(!matchController.combatEnabled()||!player.joined||player.spectator||!player.alive
            ||awaitingSpawnChoice(player,now)
            ||(player.weaponAction!=WeaponAction.READY&&now<player.weaponActionUntil))return;
        ThrowableType type=ThrowableType.parse(message.path("throwable").asText(null),player.selectedThrowable);
        if(grenades.size()>=24)return;
        if(player.throwableCount(type)<=0)return;
        double aimYaw=message.path("aimYaw").asDouble(player.yaw);
        double aimPitch=message.path("aimPitch").asDouble(player.pitch);
        if(!Double.isFinite(aimYaw)||!Double.isFinite(aimPitch))return;
        double expectedCos=Math.cos(player.pitch),aimCos=Math.cos(aimPitch);
        double dot=(-Math.sin(player.yaw)*expectedCos)*(-Math.sin(aimYaw)*aimCos)
            +Math.sin(player.pitch)*Math.sin(aimPitch)
            +(-Math.cos(player.yaw)*expectedCos)*(-Math.cos(aimYaw)*aimCos);
        if(dot<.94)return;
        if(!player.consumeThrowable(type))return;
        player.holdingThrowable=false;
        player.pendingGrenadeYaw=aimYaw;player.pendingGrenadePitch=aimPitch;player.pendingThrowable=type;
        boolean classic="CLASSIC_LEFT_HOLD".equals(message.path("throwStyle").asText());
        beginAction(player,WeaponAction.THROWING_GRENADE,classic?760:560);
        player.weaponActionCommitAt=player.weaponActionStartedAt+(classic?380:270);
    }

    /** 动画提交点才让手雷进入世界，确保第一人称松手和权威投掷物出现处于同一 Tick。 */
    private void commitGrenadeThrow(Player player,long now){
        double aimYaw=player.pendingGrenadeYaw,aimPitch=player.pendingGrenadePitch,aimCos=Math.cos(aimPitch);
        double dx=-Math.sin(aimYaw)*aimCos,dy=Math.sin(aimPitch),dz=-Math.cos(aimYaw)*aimCos;
        long id=++nextGrenadeId;
        ThrowableType type=player.pendingThrowable;
        // A firmer FPS throw: forward speed carries the projectile while pitch adds range.
        // The previous 18/14 tuning felt floaty and stayed airborne for too long.
        GrenadeState grenade=new GrenadeState(id,player.id,player.name,type,now+type.fuseMs(),
            player.x+dx*.72,player.y-.18+dy*.72,player.z+dz*.72,dx*22,dy*22+6.5,dz*22);
        grenades.put(id,grenade);
        broadcast(json.createObjectNode().put("type","grenade_thrown").put("id",id)
            .put("ownerId",player.id).put("throwable",type.id()).put("x",grenade.x).put("y",grenade.y).put("z",grenade.z));
    }

    /** Fixed-tick projectile simulation; clients only interpolate the resulting snapshots. */
    private void updateGrenades(){
        long now=System.currentTimeMillis();double dt=TICK_MS/1_000.0;
        for(GrenadeState grenade:new ArrayList<>(grenades.values())){
            if(now>=grenade.fuseAt){detonateGrenade(grenade);continue;}
            grenade.vy-=18*dt;
            double dx=grenade.vx*dt,dy=grenade.vy*dt,dz=grenade.vz*dt,length=Math.sqrt(dx*dx+dy*dy+dz*dz);
            if(length>1e-8){
                MapRuntime.RayHit hit=mapRuntime.firstObstacleHit(grenade.x,grenade.y,grenade.z,
                    dx/length,dy/length,dz/length,length);
                if(hit.hit()&&hit.distance()>1e-4&&hit.distance()<=length){
                    double nx=hit.normal().x(),ny=hit.normal().y(),nz=hit.normal().z();
                    grenade.x=hit.point().x()+nx*.035;grenade.y=hit.point().y()+ny*.035;grenade.z=hit.point().z()+nz*.035;
                    double velocityDot=grenade.vx*nx+grenade.vy*ny+grenade.vz*nz;
                    grenade.vx=(grenade.vx-1.35*velocityDot*nx)*.68;
                    grenade.vy=(grenade.vy-1.35*velocityDot*ny)*.68;
                    grenade.vz=(grenade.vz-1.35*velocityDot*nz)*.68;
                    continue;
                }
            }
            double nextX=grenade.x+dx,nextY=grenade.y+dy,nextZ=grenade.z+dz;
            if(!mapRuntime.containsHorizontal(nextX,nextZ)){grenade.vx*=-.32;grenade.vz*=-.32;}
            else{grenade.x=nextX;grenade.z=nextZ;}
            if(nextY<=.16){grenade.y=.16;if(Math.abs(grenade.vy)<1.7)grenade.vy=0;else grenade.vy=-grenade.vy*.28;grenade.vx*=.64;grenade.vz*=.64;}
            else grenade.y=nextY;
        }
    }

    private void detonateGrenade(GrenadeState grenade){
        switch(grenade.type){
            case FRAG -> explodeGrenade(grenade);
            case FLASH -> detonateFlash(grenade);
            case SMOKE -> deploySmoke(grenade);
        }
    }

    private void explodeGrenade(GrenadeState grenade){
        grenades.remove(grenade.id);Player owner=players.get(grenade.ownerId);
        ObjectNode event=json.createObjectNode().put("type","grenade_exploded").put("id",grenade.id)
            .put("ownerId",grenade.ownerId).put("x",grenade.x).put("y",grenade.y).put("z",grenade.z);
        ArrayNode victims=event.putArray("victims");long now=System.currentTimeMillis();
        for(Player target:players.values()){
            if(!target.joined||target.spectator||!target.alive||now<target.invulnerableUntil)continue;
            double tx=target.x-grenade.x,ty=(target.y-.7)-grenade.y,tz=target.z-grenade.z;
            double distance=Math.sqrt(tx*tx+ty*ty+tz*tz);if(distance>=7)continue;
            if(distance>.05){
                MapRuntime.RayHit cover=mapRuntime.firstObstacleHit(grenade.x,grenade.y,grenade.z,
                    tx/distance,ty/distance,tz/distance,distance);
                if(cover.hit()&&cover.distance()<distance-.15)continue;
            }
            int raw=Math.max(1,(int)Math.round(110*(1-distance/7)));
            DamageResolver.Result resolution=damageResolver.resolveRaw(raw,target.hp,target.armor);
            target.armor=resolution.remainingArmor();target.hp=resolution.remainingHealth();
            int dealt=resolution.dealtDamage();boolean killed=target.hp<=0;
            victims.add(json.createObjectNode().put("id",target.id).put("damage",dealt).put("distance",Math.round(distance*10)/10.0).put("killed",killed));
            ObjectNode damage=json.createObjectNode().put("type","damage_taken")
                .put("attackerId",grenade.ownerId).put("attacker",grenade.ownerName)
                .put("weapon","frag_grenade").put("sourceType","GRENADE").put("damage",dealt)
                .put("remainingHp",target.hp).put("remainingArmor",target.armor)
                .put("distance",Math.round(distance*10.0)/10.0)
                .put("sourceYaw",sourceYaw(target,grenade.x,grenade.z)).put("headshot",false).put("killed",killed);
            send(sessions.get(target.id),damage);
            if(killed){
                target.hp=0;target.alive=false;target.respawnAvailableAt=now+RESPAWN_DELAY_MS;
                if(matchController.scoringEnabled()){
                    target.deaths++;if(owner!=null&&owner!=target)owner.kills++;
                    dropWeaponOnDeath(target,now);
                }
                broadcast(json.createObjectNode().put("type","kill").put("killerId",grenade.ownerId)
                    .put("killer",grenade.ownerName).put("victimId",target.id).put("victim",target.name)
                    .put("weapon","frag_grenade").put("distance",Math.round(distance*10)/10.0)
                    .put("respawnDelayMs",RESPAWN_DELAY_MS).put("headshot",false)
                    .put("counted",matchController.scoringEnabled()));
            }
        }
        broadcast(event);
    }

    private void detonateFlash(GrenadeState grenade){
        grenades.remove(grenade.id);long now=System.currentTimeMillis();
        broadcast(json.createObjectNode().put("type","flash_detonated").put("id",grenade.id)
            .put("ownerId",grenade.ownerId).put("x",grenade.x).put("y",grenade.y).put("z",grenade.z));
        for(Player target:players.values()){
            if(!target.joined||target.spectator||!target.alive)continue;
            double tx=grenade.x-target.x,ty=grenade.y-target.y,tz=grenade.z-target.z;
            double distance=Math.sqrt(tx*tx+ty*ty+tz*tz);if(distance>=18||distance<.05)continue;
            MapRuntime.RayHit cover=mapRuntime.firstObstacleHit(target.x,target.y,target.z,tx/distance,ty/distance,tz/distance,distance);
            if(cover.hit()&&cover.distance()<distance-.15)continue;
            double cos=Math.cos(target.pitch),fx=-Math.sin(target.yaw)*cos,fy=Math.sin(target.pitch),fz=-Math.cos(target.yaw)*cos;
            double facing=Math.max(0,(fx*tx+fy*ty+fz*tz)/distance);
            // Flashbangs remain directional, but the previous falloff was too gentle to notice
            // unless the player stared directly at the detonation. Keep the 18 m gameplay range
            // while raising peripheral strength and extending full-effect recovery.
            double intensity=Math.pow(1-distance/18,.72)*(.42+.58*facing);
            if(intensity<.06)continue;
            intensity=Math.min(1,intensity*1.16);
            long duration=Math.round(700+4_000*intensity);target.blindedUntil=Math.max(target.blindedUntil,now+duration);
            GameConnection connection=sessions.get(target.id);if(connection!=null)send(connection,json.createObjectNode()
                .put("type","flash_effect").put("intensity",Math.min(1,intensity)).put("durationMs",duration)
                .put("sourceYaw",sourceYaw(target,grenade.x,grenade.z)));
        }
    }

    private void deploySmoke(GrenadeState grenade){
        grenades.remove(grenade.id);long now=System.currentTimeMillis();
        if(smokes.size()>=8){Long oldest=smokes.keySet().iterator().next();smokes.remove(oldest);}
        MapRuntime.GroundHit ground=mapRuntime.groundHeight(grenade.x,grenade.z,grenade.y,.35,30);
        double groundY=ground.hit()?ground.height():Math.max(0,grenade.y-.16);
        SmokeState smoke=new SmokeState(grenade.id,grenade.x,groundY,grenade.z,now+12_000,5.2);smokes.put(smoke.id,smoke);
        broadcast(json.createObjectNode().put("type","smoke_started").put("id",smoke.id).put("x",smoke.x).put("y",smoke.y).put("z",smoke.z).put("radius",smoke.radius).put("durationMs",12_000));
    }

    private void updateSmokes(){long now=System.currentTimeMillis();smokes.values().removeIf(smoke->now>=smoke.expiresAt);}

    private boolean smokeBlocksSight(double ax,double ay,double az,double bx,double by,double bz){
        double dx=bx-ax,dy=by-ay,dz=bz-az,lengthSquared=dx*dx+dy*dy+dz*dz;if(lengthSquared<1e-8)return false;
        for(SmokeState smoke:smokes.values()){
            double t=((smoke.x-ax)*dx+(smoke.y-ay)*dy+(smoke.z-az)*dz)/lengthSquared;t=Math.max(0,Math.min(1,t));
            double px=ax+dx*t-smoke.x,py=ay+dy*t-smoke.y,pz=az+dz*t-smoke.z;
            if(px*px+pz*pz<smoke.radius*smoke.radius&&py*py<(smoke.radius*.72)*(smoke.radius*.72))return true;
        }
        return false;
    }

    /**
     * 拒绝射击时不扣弹药，并把原因返回客户端。之前静默 return 会让正常的
     * AWM 拉栓间隔看起来像开镜 Bug。
     */
    private void rejectShot(Player player,long shotId,String reason,long remainingMs){
        GameConnection connection=sessions.get(player.id);
        if(connection!=null)send(connection,json.createObjectNode().put("type","shot_rejected").put("shotId",shotId).put("outcome",ShotOutcome.REJECTED.name()).put("reason",reason).put("remainingMs",Math.max(0,remainingMs)));
    }

    /**
     * 换弹不是“等待后直接补满”：开始时同时记录 commit 时刻和结束时刻。
     * commit 对应动画中新弹匣真正插入枪身的时间，结束时刻只负责恢复 READY。
     */
    private void reload(Player p) {
        WeaponDefinition weapon=weaponRegistry.require(p.currentWeapon);
        long now=System.currentTimeMillis();
        if (!matchController.combatEnabled() || !p.alive || awaitingSpawnChoice(p,now)
            || !p.weaponState().canReload(weapon) || (p.weaponAction!=WeaponAction.READY&&p.weaponActionUntil>now)) return;
        beginReload(p,weapon);
    }

    /**
     * Tick 驱动动作时间轴。先在 commit 时刻转移弹药，再在 end 时刻恢复 READY。
     * 两个阶段分开后，客户端丢弹匣、插弹匣等视觉事件可以与服务端结果对齐。
     */
    private void finishWeaponActions() {
        long now = System.currentTimeMillis();
        for (Player p : players.values()) {
            if (p.weaponAction==WeaponAction.RELOADING&&!p.weaponActionCommitted&&now>=p.weaponActionCommitAt) {
                p.weaponState().commitReload(weaponRegistry.require(p.currentWeapon));
                p.weaponActionCommitted=true;
            }
            if(p.weaponAction==WeaponAction.THROWING_GRENADE&&!p.weaponActionCommitted&&now>=p.weaponActionCommitAt){
                // 死亡或离开会取消尚未真正离手的投掷；复活会重新补充标准库存。
                if(p.joined&&p.alive&&matchController.combatEnabled())commitGrenadeThrow(p,now);
                p.weaponActionCommitted=true;
            }
            if (p.weaponAction != WeaponAction.READY && now >= p.weaponActionUntil) {
                p.weaponAction=WeaponAction.READY;
                p.weaponActionStartedAt=p.weaponActionUntil=p.weaponActionCommitAt=0;
                p.weaponActionCommitted=false;
                p.reloadUntil = 0;
            }
        }
    }

    private void beginAction(Player p,WeaponAction action,long durationMs){
        long now=System.currentTimeMillis();p.weaponAction=action;p.weaponActionStartedAt=now;p.weaponActionUntil=now+durationMs;
        p.reloadUntil=action==WeaponAction.RELOADING?p.weaponActionUntil:0;
        p.weaponActionCommitAt=0;p.weaponActionCommitted=false;
    }

    private void beginReload(Player p,WeaponDefinition weapon){
        beginAction(p,WeaponAction.RELOADING,weapon.reloadMs());
        p.weaponActionCommitAt=p.weaponActionStartedAt+weapon.reloadCommitMs();
    }

    private void switchWeapon(Player p, String id) {
        long now=System.currentTimeMillis();
        if (!matchController.combatEnabled() || awaitingSpawnChoice(p,now)
            ||(p.weaponAction!=WeaponAction.READY&&now<p.weaponActionUntil)
            || !weaponRegistry.contains(id) || !p.ownsWeapon(id)) return;
        if(id.equals(p.currentWeapon))return;
        WeaponDefinition next=weaponRegistry.require(id);
        p.holdingThrowable=false;
        p.equipWeapon(next);
        equipDefaultSkin(p,next);
        p.scoped = false;
        beginAction(p,WeaponAction.EQUIPPING,next.equipMs());
    }

    /**
     * 客户端只提交 skinId。武器取自服务端当前状态，随后依次校验目录、拥有关系和兼容性；
     * 因而篡改消息无法跨武器装备皮肤，也不能注入颜色、粒子数量等任意视觉参数。
     */
    private void equipSkin(Player p,String requestedWeapon,String skinId){
        WeaponDefinition weapon=weaponRegistry.require(p.currentWeapon);
        SkinEquipmentService.Result result=skinEquipmentService.equip(p,weapon,requestedWeapon,skinId);
        if(result!=SkinEquipmentService.Result.EQUIPPED){rejectSkin(p,skinId,result.name().toLowerCase());return;}
        ObjectNode event=json.createObjectNode().put("type","skin_equipped").put("playerId",p.id).put("weapon",weapon.id()).put("skinId",skinId);
        event.set("player",playerJson(p));
        broadcast(event);
    }

    private void rejectSkin(Player p,String skinId,String reason){
        send(sessions.get(p.id),json.createObjectNode().put("type","skin_rejected").put("skinId",skinId).put("reason",reason));
    }

    private void equipDefaultSkin(Player p,WeaponDefinition weapon){
        if(p.equippedSkinId(weapon.id())!=null)return;
        skinRegistry.defaultSkinId(weapon).filter(p::ownsSkin).ifPresent(id->p.equipSkin(weapon.id(),id));
    }

    /** 开镜状态由服务端保存，防止客户端宣称使用开镜精度但实际未开镜。 */
    private void scope(Player p, boolean active) {
        p.scoped = active && matchController.combatEnabled() && p.alive
            && !awaitingSpawnChoice(p,System.currentTimeMillis()) && weaponRegistry.require(p.currentWeapon).supportsScope();
        p.scopedAt=p.scoped?System.currentTimeMillis():0;
    }

    /**
     * 服务端验证道具是否可用以及玩家距离，成功后修改背包并安排道具刷新。
     * 客户端只提交拾取意图，不能自行获得武器。
     */
    private void pickup(Player p, String itemId) {
        WorldItem item = items.get(itemId);
        if (!matchController.combatEnabled() || item == null || !item.available || !p.alive
            || awaitingSpawnChoice(p,System.currentTimeMillis()) || Math.hypot(p.x - item.x, p.z - item.z) > 2.5) return;
        ObjectNode event=json.createObjectNode().put("type","pickup").put("itemId",item.id).put("itemType",item.type.name());
        String replacedWeapon=null;
        if(item.type==WorldItemType.WEAPON){
            WeaponDefinition weapon=weaponRegistry.require(item.contentId);
            replacedWeapon=modeRules.singleWeaponPerSlot()?p.replaceSlotWeapon(weapon):null;
            if(!modeRules.singleWeaponPerSlot()){p.addWeapon(weapon);p.equipWeapon(weapon);}
            equipDefaultSkin(p,weapon);beginAction(p,WeaponAction.EQUIPPING,weapon.equipMs());event.put("weapon",item.contentId);
        }else if(!applySupplyPickup(p,item.type,System.currentTimeMillis()))return;
        if(item.dynamic)items.remove(item.id);
        else{
            item.available = false;
            item.respawnAt = System.currentTimeMillis()+item.nextRespawnDelay(spreadRandom);
        }
        if(replacedWeapon!=null&&!replacedWeapon.equals(item.contentId))event.put("replacedWeapon",replacedWeapon);
        event.set("player", playerJson(p));
        send(sessions.get(p.id), event);
    }

    private boolean applySupplyPickup(Player player,WorldItemType type,long now){
        return switch(type){
            case MEDKIT_SMALL->player.restoreHealth(25);
            case ARMOR_VEST->player.restoreArmor(25);
            case SPEED_BOOST->{player.activateSpeedBoost(now,5_000);yield true;}
            case STEALTH_FIELD->{player.activateInvisibility(now,5_000);yield true;}
            case AMMO_BOX->{WeaponDefinition weapon=weaponRegistry.require(player.currentWeapon);yield player.addCurrentWeaponAmmoBox(weapon,weapon.magazineSize());}
            case THROWABLE_FRAG->player.addThrowable(ThrowableType.FRAG,2);
            case THROWABLE_FLASH->player.addThrowable(ThrowableType.FLASH,2);
            case THROWABLE_SMOKE->player.addThrowable(ThrowableType.SMOKE,2);
            case WEAPON->false;
        };
    }

    private void respawnItems() {
        long now = System.currentTimeMillis();
        items.values().removeIf(item->item.dynamic&&now>=item.expireAt);
        for (WorldItem item : items.values()) if (!item.dynamic&&!item.available && now >= item.respawnAt) item.available = true;
    }

    private void dropWeaponOnDeath(Player victim,long now){
        if(victim.spectator||victim.currentWeapon==null)return;
        WeaponDefinition weapon=weaponRegistry.require(victim.currentWeapon);
        if(weapon.slot()!=WeaponSlot.PRIMARY&&weapon.slot()!=WeaponSlot.SECONDARY)return;
        List<WorldItem> dynamicItems=items.values().stream().filter(item->item.dynamic)
            .sorted(Comparator.comparingLong(item->item.expireAt)).toList();
        if(dynamicItems.size()>=8)items.remove(dynamicItems.get(0).id);
        long sequence=++nextDroppedWeaponId;
        double offset=((sequence%5)-2)*.22;
        String id="drop-"+sequence;
        items.put(id,new WorldItem(id,weapon.id(),WorldItemType.WEAPON,
            victim.x+offset,victim.z-offset,0,0,true,now+25_000));
    }

    private void resetWorldItems(){
        items.values().removeIf(item->item.dynamic);
        items.values().forEach(item->{item.available=true;item.respawnAt=0;});
    }

    private void respawn(Player p) {
        if (!matchController.combatEnabled() || p.alive || System.currentTimeMillis()<p.respawnAvailableAt) return;
        p.respawn(mapRuntime.randomSpawn());
        ObjectNode spawn = json.createObjectNode().put("type", "spawn");
        spawn.set("player", playerJson(p));
        send(sessions.get(p.id), spawn);
    }

    private void chat(Player p, String text) {
        if (!p.joined) return;
        text = text.replaceAll("[\\p{Cntrl}]", "").strip();
        if (text.isEmpty()) return;
        if (text.length() > 100) text = text.substring(0, 100);
        broadcast(json.createObjectNode().put("type", "chat").put("name", p.name).put("text", text));
    }

    /**
     * 生成当前世界快照。客户端用它插值其他玩家，并同步本人的生命、武器、
     * 弹药、换弹状态和世界道具状态。
     */
    private void broadcastState() {
        long now=System.currentTimeMillis();
        List<Player> ranked=players.values().stream().filter(p -> p.joined && !p.spectator)
            .sorted(Comparator.comparingInt((Player p) -> p.kills).reversed()).toList();
        int snapshotCharacters=0,snapshotRecipients=0;
        for(Map.Entry<String,GameConnection> recipient:sessions.entrySet()){
            ObjectNode root=json.createObjectNode().put("type","state").put("schema",2).put("time",now)
                .put("tick",tickCount).put("tickMicros",lastTickMicros).put("queueDepth",commands.size());
            root.set("match",matchJson(now));
            ArrayNode list=root.putArray("players");
            for(Player player:ranked){
                // The owner needs inventory, ammo and reconciliation fields. Other clients only
                // need the compact public pose used for rendering and the scoreboard.
                list.add(player.id.equals(recipient.getKey())?playerJson(player,now):publicPlayerJson(player,now));
            }
            ArrayNode worldItems=root.putArray("items");
            items.values().forEach(item->{
                ObjectNode value=json.createObjectNode().put("id",item.id).put("available",item.available)
                    .put("respawnRemainingMs",item.available?0:Math.max(0,item.respawnAt-now));
                // Map-authored pickup position/type are already present in the signed map JSON.
                // Only temporary death drops need their full runtime definition every snapshot.
                if(item.dynamic)value.put("dynamic",true).put("itemType",item.type.name())
                    .put("weapon",item.contentId==null?"":item.contentId).put("x",networkNumber(item.x,1000)).put("z",networkNumber(item.z,1000))
                    .put("expireRemainingMs",Math.max(0,item.expireAt-now));
                worldItems.add(value);
            });
            ArrayNode projectileList=root.putArray("grenades");
            grenades.values().forEach(grenade->projectileList.add(json.createObjectNode().put("id",grenade.id)
                .put("ownerId",grenade.ownerId).put("throwable",grenade.type.id())
                .put("x",networkNumber(grenade.x,1000)).put("y",networkNumber(grenade.y,1000)).put("z",networkNumber(grenade.z,1000))
                .put("fuseRemainingMs",Math.max(0,grenade.fuseAt-now))));
            ArrayNode smokeList=root.putArray("smokes");
            smokes.values().forEach(smoke->smokeList.add(json.createObjectNode().put("id",smoke.id)
                .put("x",networkNumber(smoke.x,1000)).put("y",networkNumber(smoke.y,1000)).put("z",networkNumber(smoke.z,1000))
                .put("radius",networkNumber(smoke.radius,100)).put("remainingMs",Math.max(0,smoke.expiresAt-now))));
            String text=root.toString();snapshotCharacters+=text.length();snapshotRecipients++;safeSend(recipient.getValue(),text);
        }
        if(snapshotRecipients>0)lastSnapshotChars=Math.round((float)snapshotCharacters/snapshotRecipients);
    }

    /**
     * 比赛时钟与玩家输入共享同一个房间 Tick。一次击杀命令在 drainCommands 中完成
     * 计分后，本方法会在同一 Tick 检查击杀上限，因此不会再多接受一帧比赛结束后的射击。
     */
    private void updateMatch(){
        long now=System.currentTimeMillis();
        List<Player> active=rankedPlayers();
        int highestKills=active.stream().mapToInt(player->player.kills).max().orElse(0);
        matchController.update(now,active.size(),highestKills).ifPresent(this::applyMatchTransition);
    }

    /**
     * WARMUP 只负责十秒准备和 Buff 预选；进入 PLAYING 时再公平重置出生点、装备和
     * 比分，并激活预选结果。把两步分开可避免第二次 respawn 抹掉玩家刚选好的 Buff。
     */
    private void applyMatchTransition(MatchController.Transition transition){
        switch(transition.to()){
            case WARMUP -> prepareCombatants(transition.from()==MatchController.Phase.WAITING);
            case PLAYING -> startCombatants();
            case FINISHED,WAITING -> freezeCombatants();
        }
        ObjectNode phaseEvent=json.createObjectNode().put("type","match_phase");
        phaseEvent.set("match",matchJson(transition.occurredAt()));
        broadcast(phaseEvent);
        if(transition.to()==MatchController.Phase.FINISHED)broadcastMatchResult(transition.reason());
    }

    private void prepareCombatants(boolean preserveJoinPosition){
        grenades.clear();
        smokes.clear();
        WeaponDefinition starter=weaponRegistry.require("m4a1");
        for(Player player:players.values()){
            if(!player.joined||player.spectator)continue;
            player.kills=0;player.deaths=0;
            player.resetLoadout(starter);grantMelee(player);equipDefaultSkin(player,starter);
            // Humans move first so every bot safety score sees the final round-opening positions.
            if(!preserveJoinPosition&&!player.bot)player.respawn(mapRuntime.randomSpawn(),true);
        }
        for(Player player:players.values()){
            if(!player.joined||player.spectator)continue;
            if(!preserveJoinPosition&&player.bot)player.respawn(safeBotSpawn(),true);
            if(player.bot)readyBot(player,System.currentTimeMillis());
            ObjectNode spawn=json.createObjectNode().put("type","spawn");spawn.set("player",playerJson(player));
            send(sessions.get(player.id),spawn);
        }
        resetWorldItems();
    }

    private void startCombatants(){
        grenades.clear();
        smokes.clear();
        WeaponDefinition starter=weaponRegistry.require("m4a1");
        long now=System.currentTimeMillis();
        Map<Player,SpawnBuff> selections=new IdentityHashMap<>();
        for(Player player:players.values()){
            if(!player.joined||player.spectator)continue;
            selections.put(player,player.spawnBuffSelected?player.spawnBuff:SpawnBuff.NONE);
            player.kills=0;player.deaths=0;
            player.resetLoadout(starter);grantMelee(player);equipDefaultSkin(player,starter);
        }
        // Warmup remains fully playable, but combat never inherits a rushed or spawn-camped
        // position. Humans are placed first so bot safety scoring sees final player locations.
        for(Player player:players.values()){
            if(!player.joined||player.spectator||player.bot)continue;
            player.startMatch(mapRuntime.randomSpawn(),selections.getOrDefault(player,SpawnBuff.NONE));
        }
        for(Player player:players.values()){
            if(!player.joined||player.spectator||!player.bot)continue;
            player.startMatch(safeBotSpawn(),SpawnBuff.NONE);readyBot(player,now);
        }
        for(Player player:players.values()){
            if(!player.joined||player.spectator)continue;
            ObjectNode spawn=json.createObjectNode().put("type","spawn");spawn.set("player",playerJson(player));
            send(sessions.get(player.id),spawn);
        }
        bots.values().forEach(agent->{agent.nextShotAt=now+botDifficulty.reactionMs();agent.engageAt=now+botSettings.spawnHoldMs();});
        resetWorldItems();
    }

    private void freezeCombatants(){
        grenades.clear();
        smokes.clear();
        players.values().forEach(player->{player.input=PlayerInput.idle(player.yaw,player.pitch);player.jumpQueued=false;player.scoped=false;});
    }

    private void broadcastMatchResult(MatchController.FinishReason reason){
        ObjectNode event=json.createObjectNode().put("type","match_finished").put("reason",reason.name());
        ArrayNode standings=event.putArray("standings");
        List<Player> ranking=rankedPlayers();
        for(int index=0;index<ranking.size();index++){
            Player player=ranking.get(index);
            standings.add(json.createObjectNode().put("place",index+1).put("id",player.id)
                .put("name",player.name).put("kills",player.kills).put("deaths",player.deaths));
        }
        if(!ranking.isEmpty())event.put("winnerId",ranking.get(0).id).put("winnerName",ranking.get(0).name);
        event.set("match",matchJson(System.currentTimeMillis()));
        broadcast(event);
    }

    private List<Player> rankedPlayers(){
        return players.values().stream().filter(player->player.joined&&!player.spectator)
            .sorted(Comparator.comparingInt((Player player)->player.kills).reversed()
                .thenComparingInt(player->player.deaths).thenComparing(player->player.id))
            .toList();
    }

    private ObjectNode matchJson(long now){
        ObjectNode node=json.createObjectNode().put("phase",matchController.phase().name())
            .put("mode",modeRules.mode().name()).put("buffsEnabled",modeRules.buffsEnabled())
            .put("round",matchController.roundNumber()).put("phaseStartedAt",matchController.phaseStartedAt())
            .put("phaseEndsAt",matchController.phaseEndsAt()).put("remainingMs",matchController.remainingMs(now))
            .put("scoreLimit",matchController.rules().scoreLimit()).put("minPlayers",matchController.rules().minPlayers())
            .put("playerCount",rankedPlayers().size()).put("finishReason",matchController.finishReason().name());
        List<Player> ranking=rankedPlayers();
        if(!ranking.isEmpty())node.put("leaderId",ranking.get(0).id).put("leaderName",ranking.get(0).name).put("leaderKills",ranking.get(0).kills);
        return node;
    }

    private ObjectNode playerJson(Player p) { return playerJson(p,System.currentTimeMillis()); }

    private ObjectNode playerJson(Player p,long now) {
        WeaponDefinition weapon=weaponRegistry.require(p.currentWeapon);
        ObjectNode node = json.createObjectNode().put("id", p.id).put("name", p.name).put("spectator",p.spectator).put("bot",p.bot)
            .put("x",networkNumber(p.x,1000)).put("y",networkNumber(p.y,1000)).put("z",networkNumber(p.z,1000))
            .put("yaw",networkNumber(p.yaw,10000)).put("pitch",networkNumber(p.pitch,10000))
            .put("verticalVelocity",networkNumber(p.verticalVelocity,1000)).put("onGround", p.onGround).put("hp", p.hp).put("armor", p.armor).put("kills", p.kills).put("deaths", p.deaths).put("alive", p.alive).put("respawnRemainingMs",Math.max(0,p.respawnAvailableAt-now)).put("grenadeCount",p.throwableCount(ThrowableType.FRAG)).put("selectedThrowable",p.selectedThrowable.id()).put("holdingThrowable",p.holdingThrowable).put("weapon", p.currentWeapon).put("ammo", p.ammo()).put("reserveAmmo",p.reserveAmmo()).put("magazine", weapon.magazineSize()).put("reloadUntil", p.reloadUntil).put("nextShotAt", Math.max(p.lastShot + weapon.fireIntervalMs(),p.weaponActionUntil)).put("weaponAction",p.weaponAction.name()).put("weaponActionStartedAt",p.weaponActionStartedAt).put("weaponActionUntil",p.weaponActionUntil).put("weaponActionCommitAt",p.weaponActionCommitAt).put("weaponActionCommitted",p.weaponActionCommitted).put("ackSequence", p.lastProcessedInput).put("invulnerableUntil", p.invulnerableUntil).put("spawnBuff", p.spawnBuff.name()).put("spawnBuffUntil", p.spawnBuffUntil).put("spawnBuffActive", p.hasActiveSpawnBuff(now)).put("speedBoostUntil",p.speedBoostUntil).put("speedBoostActive",now<p.speedBoostUntil).put("invisibleUntil",p.invisibleUntil).put("invisibleActive",now<p.invisibleUntil).put("spawnBuffSelected",p.spawnBuffSelected).put("spawnBuffSelectionRemainingMs",Math.max(0,p.spawnBuffSelectionUntil-now));
        ObjectNode throwableInventory=node.putObject("throwables");p.throwableInventory.forEach((type,count)->throwableInventory.put(type.id(),count));
        ArrayNode owned = node.putArray("weapons");
        p.weaponStates.keySet().forEach(owned::add);
        ArrayNode inventory=node.putArray("weaponStates");
        p.weaponStates.forEach((weaponId,state)->inventory.add(json.createObjectNode().put("id",weaponId).put("ammo",state.magazineAmmo()).put("reserveAmmo",state.reserveAmmo())));
        ObjectNode equipped=node.putObject("equippedSlots");
        p.equippedSlots.forEach((slot,weaponId)->equipped.put(slot.name(),weaponId));
        node.put("skinId",Objects.toString(p.equippedSkinId(p.currentWeapon),""));
        ObjectNode equippedSkins=node.putObject("equippedSkins");p.equippedSkinIds.forEach(equippedSkins::put);
        return node;
    }

    private ObjectNode publicPlayerJson(Player p,long now){
        return json.createObjectNode().put("id",p.id).put("name",p.name).put("bot",p.bot)
            .put("x",networkNumber(p.x,1000)).put("y",networkNumber(p.y,1000)).put("z",networkNumber(p.z,1000))
            .put("yaw",networkNumber(p.yaw,10000)).put("pitch",networkNumber(p.pitch,10000))
            .put("hp",p.hp).put("armor",p.armor).put("kills",p.kills).put("deaths",p.deaths).put("alive",p.alive)
            .put("respawnRemainingMs",Math.max(0,p.respawnAvailableAt-now)).put("weapon",p.currentWeapon)
            .put("skinId",Objects.toString(p.equippedSkinId(p.currentWeapon),""))
            .put("selectedThrowable",p.selectedThrowable.id()).put("weaponAction",p.weaponAction.name())
            .put("weaponActionStartedAt",p.weaponActionStartedAt).put("weaponActionUntil",p.weaponActionUntil)
            .put("weaponActionCommitAt",p.weaponActionCommitAt).put("invulnerableUntil",p.invulnerableUntil)
            .put("invisibleActive",now<p.invisibleUntil);
    }

    private static double networkNumber(double value,double factor){
        return Math.rint(value*factor)/factor;
    }

    private void system(String text) {
        broadcast(json.createObjectNode().put("type", "system").put("text", text));
    }

    private void event(String id, String type, String target) {
        GameConnection session = sessions.get(id);
        if (session != null) send(session, json.createObjectNode().put("type", type).put("target", target));
    }

    private void broadcast(JsonNode message) {
        String text = message.toString();
        if("state".equals(message.path("type").asText()))lastSnapshotChars=text.length();
        sessions.values().forEach(session -> safeSend(session, text));
    }

    private void send(GameConnection session, JsonNode message) {
        if (session != null) safeSend(session, message.toString());
    }

    private void safeSend(GameConnection session, String text) {
        if (!session.isOpen()) return;
        outboundChars+=text.length();
        session.send(text);
    }

    private String cleanName(String value) {
        String name = value.replaceAll("[<>\\p{Cntrl}]", "").strip();
        if (name.isEmpty()) name = "玩家";
        return name.substring(0, Math.min(12, name.length()));
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
