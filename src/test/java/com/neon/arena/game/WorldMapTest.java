package com.neon.arena.game;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WorldMapTest {
  @Test void rejectsMapBoundary(){assertTrue(WorldMap.collides(49,1.7,0));assertTrue(WorldMap.collides(0,1.7,-49));}
  @Test void detectsObstacleAtMapCenter(){assertTrue(WorldMap.collides(0,1.7,0));assertFalse(WorldMap.collides(8,1.7,8));}
  @Test void allowsStandingAboveLowObstacle(){assertFalse(WorldMap.collides(0,5,0));}
  @Test void rayStopsAtCenterObstacle(){double distance=WorldMap.firstObstacleDistance(2,1.7,10,0,0,-1,100);assertEquals(6.5,distance,.001);}
  @Test void rayWithoutObstacleKeepsMaximumDistance(){double distance=WorldMap.firstObstacleDistance(40,1.7,40,1,0,0,45);assertEquals(45,distance,.001);}
}
