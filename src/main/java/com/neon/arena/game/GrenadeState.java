package com.neon.arena.game;

final class GrenadeState {
  final long id;
  final String ownerId;
  final String ownerName;
  final ThrowableType type;
  final long fuseAt;
  double x,y,z,vx,vy,vz;

  GrenadeState(long id,String ownerId,String ownerName,ThrowableType type,long fuseAt,
      double x,double y,double z,double vx,double vy,double vz){
    this.id=id;this.ownerId=ownerId;this.ownerName=ownerName;this.type=type;this.fuseAt=fuseAt;
    this.x=x;this.y=y;this.z=z;this.vx=vx;this.vy=vy;this.vz=vz;
  }
}
