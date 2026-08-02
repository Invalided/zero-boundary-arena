package com.neon.arena.game;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.map.MapCatalog;
import com.neon.arena.map.MapRuntime;
import com.neon.arena.skin.SkinEquipmentService;
import com.neon.arena.skin.SkinRegistry;
import com.neon.arena.weapon.WeaponRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * MVP 官方房间目录。每个 GameRoom 拥有独立比赛状态和 Tick；武器、皮肤与地图定义是只读共享的。
 * 自定义房间将来只需要增加一个受控的 createRoom，不需要复制 GameRoom 战斗逻辑。
 */
@Component
public class RoomManager {
  private final Map<String, GameRoom> rooms = new LinkedHashMap<>();
  private final GameRoom defaultRoom;
  private final MapCatalog catalog;
  private final ObjectMapper json;
  private final WeaponRegistry weaponRegistry;
  private final SkinRegistry skinRegistry;
  private final SkinEquipmentService skinEquipmentService;
  private final DamageResolver damageResolver;
  private final GameModeRules modeRules;
  private final MatchController matchTemplate;
  private final BotSettings botSettings;
  private final String buildVersion;
  private final int roomCapacity,spectatorCapacity,maxConnections;
  private final AtomicInteger activeConnections=new AtomicInteger();

  @Autowired
  public RoomManager(
      GameRoom defaultRoom, MapCatalog catalog, ObjectMapper json, WeaponRegistry weaponRegistry,
      SkinRegistry skinRegistry, SkinEquipmentService skinEquipmentService,
      DamageResolver damageResolver, GameModeRules modeRules, MatchController matchTemplate,
      BotSettings botSettings,
      @Value("${neon.version:dev}") String buildVersion,
      @Value("${game.capacity.players-per-room:12}") int roomCapacity,
      @Value("${game.capacity.spectators-per-room:4}") int spectatorCapacity,
      @Value("${game.capacity.max-connections:128}") int maxConnections) {
    this.defaultRoom = defaultRoom;this.catalog = catalog;this.json = json;
    this.weaponRegistry = weaponRegistry;this.skinRegistry = skinRegistry;
    this.skinEquipmentService = skinEquipmentService;this.damageResolver = damageResolver;
    this.modeRules = modeRules;this.matchTemplate = matchTemplate;this.botSettings=botSettings;
    this.buildVersion = GameRoom.resolveBuildVersion(buildVersion);
    this.roomCapacity=Math.max(1,roomCapacity);this.spectatorCapacity=Math.max(0,spectatorCapacity);this.maxConnections=Math.max(this.roomCapacity,maxConnections);
  }

  @PostConstruct
  void startRooms() {
    defaultRoom.configureCapacity(roomCapacity,spectatorCapacity);
    rooms.put(defaultRoom.roomId(), defaultRoom);
    catalog.entries().stream().filter(entry -> !entry.definition().id().equals(defaultRoom.mapRuntime().id()))
        .forEach(entry -> {
          MatchController match = new MatchController(matchTemplate.rules());
          GameRoom room = new GameRoom(json, weaponRegistry, skinRegistry, skinEquipmentService,
              new MapRuntime(entry.definition()), match, damageResolver, modeRules, buildVersion,
              entry.roomId(), true, botSettings);
          room.start();
          room.configureCapacity(roomCapacity,spectatorCapacity);
          rooms.put(entry.roomId(), room);
        });
  }

  public GameRoom require(String roomId) {
    GameRoom room = rooms.get(roomId);
    return room == null ? defaultRoom : room;
  }

  public Optional<GameRoom> find(String roomId){return Optional.ofNullable(rooms.get(roomId));}
  public boolean tryAcquireConnection(){
    while(true){int current=activeConnections.get();if(current>=maxConnections)return false;if(activeConnections.compareAndSet(current,current+1))return true;}
  }
  public void releaseConnection(){activeConnections.updateAndGet(value->Math.max(0,value-1));}
  public int activeConnections(){return activeConnections.get();}
  public int maxConnections(){return maxConnections;}
  public int roomCapacity(){return roomCapacity;}
  public int spectatorCapacity(){return spectatorCapacity;}

  public String defaultRoomId() { return defaultRoom.roomId(); }
  public Map<String, GameRoom> rooms() { return Map.copyOf(rooms); }

  @PreDestroy
  void stopRooms() {
    rooms.values().stream().filter(room -> room != defaultRoom).forEach(GameRoom::stop);
  }
}
