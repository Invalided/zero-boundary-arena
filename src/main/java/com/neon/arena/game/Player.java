package com.neon.arena.game;

import com.neon.arena.weapon.WeaponDefinition;
import com.neon.arena.weapon.WeaponSlot;
import com.neon.arena.map.MapRuntime;
import java.util.*;

public class Player {
  public final String id;
  public String name="玩家";
  public double x,y=MapRuntime.EYE_HEIGHT,z,yaw,pitch,verticalVelocity;
  public int hp=100,armor=50,kills,deaths;
  public final Map<ThrowableType,Integer> throwableInventory=new EnumMap<>(ThrowableType.class);
  public ThrowableType selectedThrowable=ThrowableType.FRAG;
  public boolean alive=true,joined=false,spectator=false,bot=false,onGround=true,jumpQueued,scoped,holdingThrowable;
  public long lastShot,reloadUntil,lastProcessedInput,invulnerableUntil;
  public long respawnAvailableAt;
  public long lastShotRequestId,scopedAt;
  public long jammedUntil;
  public long blindedUntil;
  public long speedBoostUntil;
  public long invisibleUntil;
  public long weaponActionStartedAt,weaponActionUntil,weaponActionCommitAt;
  public boolean weaponActionCommitted;
  public double pendingGrenadeYaw,pendingGrenadePitch;
  public ThrowableType pendingThrowable=ThrowableType.FRAG;
  /** 当前出生选择及本次出生的有效截止时间，过期后效果自动失效。 */
  public SpawnBuff spawnBuff = SpawnBuff.NONE;
  public long spawnBuffUntil;
  public long spawnBuffSelectionUntil;
  public boolean spawnBuffSelected;
  public WeaponAction weaponAction=WeaponAction.READY;
  public PlayerInput input=PlayerInput.idle();
  public String currentWeapon;
  public final Map<String,PlayerWeaponState> weaponStates=new LinkedHashMap<>();
  public final Map<WeaponSlot,String> equippedSlots=new EnumMap<>(WeaponSlot.class);
  public final Set<String> ownedSkinIds=new LinkedHashSet<>();
  public final Map<String,String> equippedSkinIds=new LinkedHashMap<>();

  public Player(String id,WeaponDefinition starter){this(id,starter,WorldMap.randomSpawn());}
  public Player(String id,WeaponDefinition starter,double[] spawn){this.id=id;addWeapon(starter);equipWeapon(starter);respawn(spawn,true);}
  public void respawn(){respawn(WorldMap.randomSpawn());}
  /** 房间提供出生坐标后，Player 只负责重置自身状态，不再决定地图策略。 */
  public void respawn(double[] spawn){respawn(spawn,false);}
  /**
   * 新局准备和普通阵亡复活都使用统一的 10 秒选择窗口；选择窗口同时就是服务端
   * 无敌窗口，不能只延长前端卡片，否则会出现玩家还在菜单里却已经受到伤害。
   */
  public void respawn(double[] spawn,boolean roundOpening){if(spawn==null||spawn.length<2)throw new IllegalArgumentException("spawn requires x and z");long now=System.currentTimeMillis();long selectionMs=10_000;x=spawn[0];z=spawn[1];if(spawn.length>=3)yaw=spawn[2];pitch=0;y=MapRuntime.EYE_HEIGHT;hp=100;armor=50;resetThrowables();alive=true;respawnAvailableAt=0;lastShot=0;reloadUntil=0;verticalVelocity=0;onGround=true;jumpQueued=false;scoped=false;holdingThrowable=false;scopedAt=0;input=PlayerInput.idle(yaw,pitch);invulnerableUntil=now+selectionMs;spawnBuff=SpawnBuff.NONE;spawnBuffUntil=0;spawnBuffSelectionUntil=invulnerableUntil;spawnBuffSelected=false;jammedUntil=0;blindedUntil=0;speedBoostUntil=0;invisibleUntil=0;weaponAction=WeaponAction.READY;weaponActionStartedAt=weaponActionUntil=weaponActionCommitAt=0;weaponActionCommitted=false;pendingGrenadeYaw=pendingGrenadePitch=0;pendingThrowable=selectedThrowable;}
  public void resetThrowables(){throwableInventory.clear();for(ThrowableType type:ThrowableType.values())throwableInventory.put(type,1);selectedThrowable=ThrowableType.FRAG;}
  public int throwableCount(ThrowableType type){return throwableInventory.getOrDefault(type,0);}
  public boolean consumeThrowable(ThrowableType type){int count=throwableCount(type);if(count<=0)return false;throwableInventory.put(type,count-1);selectedThrowable=type;return true;}
  public boolean addThrowable(ThrowableType type,int maximum){int count=throwableCount(type);if(count>=maximum)return false;throwableInventory.put(type,count+1);return true;}
  public boolean restoreHealth(int amount){if(amount<=0||hp>=100)return false;hp=Math.min(100,hp+amount);return true;}
  public boolean restoreArmor(int amount){if(amount<=0||armor>=50)return false;armor=Math.min(50,armor+amount);return true;}
  public void activateSpeedBoost(long now,long durationMs){speedBoostUntil=Math.max(speedBoostUntil,now)+Math.max(0,durationMs);}
  public void activateInvisibility(long now,long durationMs){invisibleUntil=Math.max(invisibleUntil,now)+Math.max(0,durationMs);}
  /**
   * 准备阶段结束后重新放置玩家，并把预选结果激活到正式比赛。这里不能继续调用普通
   * selectSpawnBuff：正式开局需要明确结束准备状态、将未选择玩家归一为 NONE，并让
   * 有效 Buff 的五秒生命周期从比赛开始时统一计时。
   */
  public void startMatch(double[] spawn,SpawnBuff selectedBuff){
    respawn(spawn,true);
    activateMatchBuff(selectedBuff);
  }
  /** Warmup movement is meaningful: formal combat starts where preparation ended. */
  public void startMatchFromCurrentPosition(SpawnBuff selectedBuff){
    activateMatchBuff(selectedBuff);
  }
  private void activateMatchBuff(SpawnBuff selectedBuff){
    long now=System.currentTimeMillis();
    spawnBuff=selectedBuff==null?SpawnBuff.NONE:selectedBuff;
    spawnBuffSelected=true;
    spawnBuffSelectionUntil=now;
    invulnerableUntil=now;
    spawnBuffUntil=spawnBuff==SpawnBuff.NONE?0:now+5_000;
  }
  public boolean hasActiveSpawnBuff(long now){return spawnBuff!=SpawnBuff.NONE&&now<spawnBuffUntil;}
  public boolean selectSpawnBuff(SpawnBuff buff,long now){
    if(!alive||spawnBuffSelected||buff==null||now>=spawnBuffSelectionUntil)return false;
    spawnBuff=buff;spawnBuffSelected=true;spawnBuffSelectionUntil=now;invulnerableUntil=now;
    spawnBuffUntil=buff==SpawnBuff.NONE?0:now+5_000;return true;
  }
  /** 当前版本每局恢复 M4 初始装备；未来空手出生只需要替换这里传入的 starter。 */
  public void resetLoadout(WeaponDefinition starter){weaponStates.clear();equippedSlots.clear();addWeapon(starter);equipWeapon(starter);}
  public void addWeapon(WeaponDefinition definition){weaponStates.putIfAbsent(definition.id(),new PlayerWeaponState(definition));equippedSlots.putIfAbsent(definition.slot(),definition.id());}
  public void equipWeapon(WeaponDefinition definition){if(!ownsWeapon(definition.id()))throw new IllegalStateException("Weapon not owned: "+definition.id());equippedSlots.put(definition.slot(),definition.id());currentWeapon=definition.id();}
  /**
   * 正式槽位拾取：同一个 PRIMARY/SECONDARY 槽只保留新武器。返回被替换的 weaponId，
   * 方便客户端提示和未来生成地面掉落物；当前 MVP 先销毁旧枪，避免复制道具经济。
   */
  public String replaceSlotWeapon(WeaponDefinition definition){
    String previous=equippedSlots.get(definition.slot());
    if(previous!=null&&!previous.equals(definition.id()))weaponStates.remove(previous);
    weaponStates.putIfAbsent(definition.id(),new PlayerWeaponState(definition));
    equippedSlots.put(definition.slot(),definition.id());currentWeapon=definition.id();return previous;
  }
  public boolean ownsWeapon(String weaponId){return weaponStates.containsKey(weaponId);}
  public boolean ownsSkin(String skinId){return ownedSkinIds.contains(skinId);}
  public void grantSkin(String skinId){ownedSkinIds.add(skinId);}
  public void equipSkin(String weaponId,String skinId){if(!ownsSkin(skinId))throw new IllegalStateException("Skin not owned: "+skinId);equippedSkinIds.put(weaponId,skinId);}
  public String equippedSkinId(String weaponId){return equippedSkinIds.get(weaponId);}
  public PlayerWeaponState weaponState(){return weaponStates.get(currentWeapon);}
  public int ammo(){return weaponState().magazineAmmo();}
  public int reserveAmmo(){return weaponState().reserveAmmo();}
  public boolean addCurrentWeaponReserve(WeaponDefinition definition,int amount){return weaponState().addReserveAmmo(definition,amount);}
  public boolean addCurrentWeaponAmmoBox(WeaponDefinition definition,int amount){return weaponState().addAmmoBox(definition,amount);}
}
