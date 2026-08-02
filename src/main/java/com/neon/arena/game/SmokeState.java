package com.neon.arena.game;

final class SmokeState {
  final long id;
  final double x,y,z;
  final long expiresAt;
  final double radius;

  SmokeState(long id,double x,double y,double z,long expiresAt,double radius){
    this.id=id;this.x=x;this.y=y;this.z=z;this.expiresAt=expiresAt;this.radius=radius;
  }
}
