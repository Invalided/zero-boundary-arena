package com.neon.arena.game;

import java.util.random.RandomGenerator;

/** 把服务端认可的瞄准方向和随机圆盘散布组合成最终单位射线。 */
public final class ShotDirectionResolver {
  public record Direction(double x,double y,double z) {}

  /**
   * spread 使用弧度近似值。sqrt(random) 让采样在圆盘面积上均匀，避免中心弹孔过密；
   * right/up 是瞄准方向的局部正交基，因此无论玩家朝向和俯仰如何，散布形状都一致。
   */
  public Direction resolve(double yaw,double pitch,double spread,RandomGenerator random){
    double cosPitch=Math.cos(pitch);
    double fx=-Math.sin(yaw)*cosPitch,fy=Math.sin(pitch),fz=-Math.cos(yaw)*cosPitch;
    double rx=Math.cos(yaw),ry=0,rz=-Math.sin(yaw);
    double ux=ry*fz-rz*fy,uy=rz*fx-rx*fz,uz=rx*fy-ry*fx;
    double radius=Math.sqrt(random.nextDouble())*Math.max(0,spread),angle=random.nextDouble()*Math.PI*2;
    double x=fx+rx*Math.cos(angle)*radius+ux*Math.sin(angle)*radius;
    double y=fy+ry*Math.cos(angle)*radius+uy*Math.sin(angle)*radius;
    double z=fz+rz*Math.cos(angle)*radius+uz*Math.sin(angle)*radius;
    double length=Math.sqrt(x*x+y*y+z*z);
    return new Direction(x/length,y/length,z/length);
  }
}
