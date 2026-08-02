package com.neon.arena.game;

import org.junit.jupiter.api.Test;
import java.util.SplittableRandom;
import static org.junit.jupiter.api.Assertions.*;

class ShotDirectionResolverTest {
  private final ShotDirectionResolver resolver=new ShotDirectionResolver();

  @Test void zeroSpreadPreservesAimDirection(){
    var direction=resolver.resolve(0,0,0,new SplittableRandom(1));
    assertEquals(0,direction.x(),0.000001);assertEquals(0,direction.y(),0.000001);assertEquals(-1,direction.z(),0.000001);
  }

  @Test void scatteredDirectionRemainsNormalizedAndInsideSmallCone(){
    var direction=resolver.resolve(0.7,-0.3,0.025,new SplittableRandom(7));
    double length=Math.sqrt(direction.x()*direction.x()+direction.y()*direction.y()+direction.z()*direction.z());
    assertEquals(1,length,0.000001);
    double fx=-Math.sin(0.7)*Math.cos(-0.3),fy=Math.sin(-0.3),fz=-Math.cos(0.7)*Math.cos(-0.3);
    assertTrue(direction.x()*fx+direction.y()*fy+direction.z()*fz>0.999);
  }
}
