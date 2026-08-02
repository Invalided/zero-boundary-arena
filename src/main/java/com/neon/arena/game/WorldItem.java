package com.neon.arena.game;
public class WorldItem {
  public final String id,contentId;public final WorldItemType type;public final double x,z;
  public final long respawnMinMs,respawnMaxMs;public final boolean dynamic;public final long expireAt;
  public boolean available=true;public long respawnAt;
  public WorldItem(String id,String contentId,WorldItemType type,double x,double z,long respawnMinMs,long respawnMaxMs){
    this(id,contentId,type,x,z,respawnMinMs,respawnMaxMs,false,0);
  }
  public WorldItem(String id,String contentId,WorldItemType type,double x,double z,long respawnMinMs,long respawnMaxMs,boolean dynamic,long expireAt){
    this.id=id;this.contentId=contentId;this.type=type;this.x=x;this.z=z;this.dynamic=dynamic;this.expireAt=expireAt;
    this.respawnMinMs=respawnMinMs;this.respawnMaxMs=Math.max(respawnMinMs,respawnMaxMs);
  }
  public long nextRespawnDelay(java.util.random.RandomGenerator random){
    return respawnMinMs==respawnMaxMs?respawnMinMs:random.nextLong(respawnMinMs,respawnMaxMs+1);
  }
}
