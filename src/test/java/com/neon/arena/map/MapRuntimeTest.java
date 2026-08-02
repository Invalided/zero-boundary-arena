package com.neon.arena.map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Random;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MapRuntimeTest {
  private MapRuntime runtime;

  @BeforeEach
  void loadArena() {
    runtime = new MapRuntime(new MapLoader(new ObjectMapper())
        .loadClasspath("/static/maps/arena.json"));
  }

  @Test
  void preservesBoundaryAndBoxCollisionAfterNativeV2Migration() {
    assertTrue(runtime.collides(49, 1.7, 0));
    assertTrue(runtime.collides(0, 1.7, -49));
    assertTrue(runtime.collides(0, 1.7, 0));
    assertFalse(runtime.collides(8, 1.7, 8));
    assertFalse(runtime.collides(0, 5, 0));
  }

  @Test
  void navigationGraphRoutesAroundTheBlockedCoreOnlyWhenNeeded() {
    MapRuntime polygon = new MapRuntime(new MapLoader(new ObjectMapper())
        .loadClasspath("/static/maps/polygon-arena.json"));

    MapRuntime.NavigationWaypoint routed = polygon.nextNavigationWaypoint(0, -14, 0, 14);

    assertNotNull(routed);
    assertTrue(routed.id().equals("core-se") || routed.id().equals("core-sw"));
    assertNull(polygon.nextNavigationWaypoint(20, 20, 22, 20));
  }

  @Test
  void polygonArenaFiringGapsMatchTheVisibleEnergyStationGeometry() {
    MapRuntime polygon = new MapRuntime(new MapLoader(new ObjectMapper())
        .loadClasspath("/static/maps/polygon-arena.json"));

    assertFalse(polygon.firstObstacleHit(2.4, 1.7, -7, 0, 0, 1, 14).hit(),
        "the open lane beside the energy cell must pass through the former core volume");
    assertEquals("energy-core-strut-se",
        polygon.firstObstacleHit(1.55, 1.7, -7, 0, 0, 1, 14).colliderId());

    assertFalse(polygon.firstObstacleHit(1.1, 2.2, 30, 0, 0, 1, 8).hit(),
        "the visible gap beside the north relay mast must pass shots");
    assertEquals("north-relay-mast",
        polygon.firstObstacleHit(0, 2.2, 30, 0, 0, 1, 8).colliderId());

    assertFalse(polygon.firstObstacleHit(0, 1.7, -38, 0, 0, 1, 8).hit(),
        "the opening between the south console pedestals must pass shots");
    assertEquals("south-console-pedestal-west",
        polygon.firstObstacleHit(-1.55, 1.7, -38, 0, 0, 1, 8).colliderId());
  }

  @Test
  void trainingPlatformBaseClosesTheVisualUndersideWithoutBlockingItsRoute() {
    assertTrue(runtime.collides(-3.9, MapRuntime.EYE_HEIGHT, 24));
    assertFalse(runtime.collides(-4.3, MapRuntime.EYE_HEIGHT, 24));
  }

  @Test
  void rayHitCarriesAuthoritativeSurfacePointAndNormal() {
    MapRuntime.RayHit hit = runtime.firstObstacleHit(2, 1.7, 10, 0, 0, -1, 100);

    assertTrue(hit.hit());
    assertEquals("core-base", hit.colliderId());
    assertEquals("metal", hit.surface());
    assertEquals(6.5, hit.distance(), 0.001);
    assertEquals(new MapDefinition.Vec3(2, 1.7, 3.5), hit.point());
    assertEquals(new MapDefinition.Vec3(0, 0, 1), hit.normal());

    MapRuntime.RayHit opposite = runtime.firstObstacleHit(-2, 1.7, -10, 0, 0, 1, 100);
    assertEquals(6.5, opposite.distance(), 0.001);
    assertEquals(new MapDefinition.Vec3(0, 0, -1), opposite.normal());
  }

  @Test
  void rayMissKeepsMaximumDistance() {
    MapRuntime.RayHit hit = runtime.firstObstacleHit(40, 1.7, 40, 1, 0, 0, 45);
    assertFalse(hit.hit());
    assertEquals(45, hit.distance(), 0.001);
  }

  @Test
  void spawnAndItemsPreserveLegacyBehavior() {
    for (int i = 0; i < 100; i++) {
      double[] spawn = runtime.randomSpawn(new Random(i));
      assertEquals(3,spawn.length);
      assertTrue(Math.abs(spawn[0]) < 45);
      assertTrue(Math.abs(spawn[1]) < 45);
      assertTrue(Double.isFinite(spawn[2]));
      assertFalse(runtime.collides(spawn[0], 1.7, spawn[1]));
    }
    assertEquals(14, runtime.items().size());
    assertEquals(new MapRuntime.RuntimeItem("ak47-01", "ak47", -12, -24), runtime.items().get(1));
  }

  @Test
  void exposesOneAuthoritativePlayerCoordinateModel() {
    assertEquals(0.45, MapRuntime.PLAYER_RADIUS);
    assertEquals(1.70, MapRuntime.PLAYER_HEIGHT);
    assertEquals(1.70, MapRuntime.EYE_HEIGHT);
    assertEquals(0.30, MapRuntime.STEP_HEIGHT);
    assertEquals(0.15, MapRuntime.GROUND_SNAP);
  }

  @Test
  void landsOnPlatformOnlyWhenCrossingItsTopFromAbove() {
    MapRuntime platformMap = runtimeWith(""
        + "{\"id\":\"thin\",\"type\":\"PLATFORM\",\"center\":[0,1,0],"
        + "\"size\":[4,0.4,4],\"solid\":false,\"surface\":\"metal\"}");

    MapRuntime.VerticalMove landed = platformMap.resolveVertical(0, 0, 3.0, -5, 0.1);
    assertTrue(landed.onGround());
    assertEquals(1.2 + MapRuntime.EYE_HEIGHT, landed.eyeY(), 0.001);

    // 脚底仍在平台下方时，下降只能落回世界地面，不能隔空吸附到平台顶面。
    MapRuntime.VerticalMove below = platformMap.resolveVertical(0, 0, 1.72, -1, 0.1);
    assertTrue(below.onGround());
    assertEquals(MapRuntime.EYE_HEIGHT, below.eyeY(), 0.001);
  }

  @Test
  void solidPlatformBlocksItsVolumeWhileThinPlatformOnlyProvidesTopSurface() {
    MapRuntime solid = runtimeWith(""
        + "{\"id\":\"solid\",\"type\":\"PLATFORM\",\"center\":[0,1,0],"
        + "\"size\":[4,0.4,4],\"solid\":true,\"surface\":\"metal\"}");
    MapRuntime thin = runtimeWith(""
        + "{\"id\":\"thin\",\"type\":\"PLATFORM\",\"center\":[0,1,0],"
        + "\"size\":[4,0.4,4],\"solid\":false,\"surface\":\"metal\"}");

    assertTrue(solid.collides(0, MapRuntime.EYE_HEIGHT, 0));
    assertFalse(thin.collides(0, MapRuntime.EYE_HEIGHT, 0));
    MapRuntime.VerticalMove ceiling = solid.resolveVertical(0, 0, 0.6, 4, 0.1);
    assertEquals(0.8, ceiling.eyeY(), 0.001);
    assertEquals(0, ceiling.verticalVelocity(), 0.001);
    MapRuntime.RayHit solidHit = solid.firstObstacleHit(0, 1, -4, 0, 0, 1, 10);
    assertTrue(solidHit.hit());
    assertEquals("solid", solidHit.colliderId());
    assertEquals(2, solidHit.distance(), 0.001);
    assertFalse(thin.firstObstacleHit(0, 1, -4, 0, 0, 1, 10).hit());
  }

  @Test
  void computesSameSlopeForAllFourRampDirections() {
    String ramps = String.join(",",
        ramp("px", 0, 0, "POS_X"), ramp("nx", 10, 0, "NEG_X"),
        ramp("pz", 20, 0, "POS_Z"), ramp("nz", 30, 0, "NEG_Z"));
    MapRuntime rampMap = runtimeWith(ramps);

    assertRampHeight(rampMap, 2, 0, "px");
    assertRampHeight(rampMap, 8, 0, "nx");
    assertRampHeight(rampMap, 20, 2, "pz");
    assertRampHeight(rampMap, 30, -2, "nz");
    assertFalse(rampMap.groundHeight(2, 2, 1, 0.3, 0.15).hit());
  }

  @Test
  void rampSideIsSolidButTopAndOutsideRemainWalkable() {
    MapRuntime rampMap = runtimeWith(ramp("ramp", 0, 0, "POS_X"));

    assertTrue(rampMap.collides(2, MapRuntime.EYE_HEIGHT, 1.2));
    assertFalse(rampMap.collides(2, 1 + MapRuntime.EYE_HEIGHT, 0));
    assertFalse(rampMap.collides(2, MapRuntime.EYE_HEIGHT, 1.6));
  }

  @Test
  void rayHitsExactSlopeForAllFourRampDirections() {
    String ramps = String.join(",",
        ramp("px", 0, 0, "POS_X"), ramp("nx", 10, 0, "NEG_X"),
        ramp("pz", 20, 0, "POS_Z"), ramp("nz", 30, 0, "NEG_Z"));
    MapRuntime rampMap = runtimeWith(ramps);

    assertRampRayHit(rampMap, 2, 0, "px", -1, 0);
    assertRampRayHit(rampMap, 8, 0, "nx", 1, 0);
    assertRampRayHit(rampMap, 20, 2, "pz", 0, -1);
    assertRampRayHit(rampMap, 30, -2, "nz", 0, 1);
  }

  @Test
  void rampRayRejectsInfinitePlaneOutsideRunAndWidth() {
    MapRuntime rampMap = runtimeWith(ramp("ramp", 0, 0, "POS_X"));

    assertFalse(rampMap.firstObstacleHit(-0.1, 3, 0, 0, -1, 0, 10).hit());
    assertFalse(rampMap.firstObstacleHit(4.1, 3, 0, 0, -1, 0, 10).hit());
    assertFalse(rampMap.firstObstacleHit(2, 3, 1.1, 0, -1, 0, 10).hit());
  }

  @Test
  void nearestRampWinsAndNormalFacesIncomingRay() {
    MapRuntime rampMap = runtimeWith(String.join(",",
        ramp("near", 0, 0, "POS_X"),
        "{\"id\":\"far\",\"type\":\"BOX\",\"center\":[2,0.25,0],"
            + "\"size\":[2,0.5,2],\"surface\":\"metal\"}"));

    MapRuntime.RayHit hit = rampMap.firstObstacleHit(2, 3, 0, 0, -1, 0, 10);
    assertEquals("near", hit.colliderId());
    assertEquals(2, hit.distance(), 0.001);
    assertTrue(hit.normal().y() > 0);

    MapRuntime onlyRamp = runtimeWith(ramp("near", 0, 0, "POS_X"));
    MapRuntime.RayHit underside = onlyRamp.firstObstacleHit(2, 0, 0, 0, 1, 0, 10);
    assertEquals("near", underside.colliderId());
    assertTrue(underside.normal().y() < 0);
  }

  @Test
  void matchesSharedClientServerGoldenFixture() throws Exception {
    ObjectMapper mapper = new ObjectMapper();
    MapRuntime shared = new MapRuntime(new MapLoader(mapper)
        .loadClasspath("/maps/map-runtime-v2.json"));
    JsonNode golden = mapper.readTree(MapRuntimeTest.class
        .getResourceAsStream("/maps/map-runtime-golden.json"));

    assertEquals(golden.path("boxBlocksAtGround").asBoolean(), shared.collides(0, 1.7, 0));
    assertEquals(golden.path("boxAllowsAboveTop").asBoolean(), shared.collides(0, 3.7, 0));
    assertEquals(golden.path("solidPlatformBlocksSide").asBoolean(), shared.collides(4, 2.7, 0));
    assertEquals(golden.path("oneWayPlatformBlocksSide").asBoolean(), shared.collides(-4, 1.7, 0));
    assertEquals(golden.path("platformTop").asDouble(),
        shared.groundHeight(4, 0, 2, .3, .15).height(), .001);
    assertEquals(golden.path("positiveZRampMiddle").asDouble(),
        shared.groundHeight(0, -6, 1, .3, .15).height(), .001);
    assertEquals(golden.path("negativeXRampMiddle").asDouble(),
        shared.groundHeight(6, 5, 1, .3, .15).height(), .001);
    assertEquals(golden.path("outsideBoundary").asBoolean(), shared.collides(9.8, 1.7, 0));
  }

  private static void assertRampHeight(MapRuntime rampMap, double x, double z, String id) {
    MapRuntime.GroundHit hit = rampMap.groundHeight(x, z, 1, 0.3, 0.15);
    assertTrue(hit.hit());
    assertEquals(1, hit.height(), 0.001);
    assertEquals(id, hit.colliderId());
  }

  private static void assertRampRayHit(
      MapRuntime rampMap, double x, double z, String id, double expectedNxSign,
      double expectedNzSign) {
    MapRuntime.RayHit hit = rampMap.firstObstacleHit(x, 3, z, 0, -1, 0, 10);
    assertTrue(hit.hit());
    assertEquals(id, hit.colliderId());
    assertEquals("concrete", hit.surface());
    assertEquals(2, hit.distance(), 0.001);
    assertEquals(new MapDefinition.Vec3(x, 1, z), hit.point());
    assertEquals(expectedNxSign * 0.4472135955, hit.normal().x(), 0.000001);
    assertEquals(0.894427191, hit.normal().y(), 0.000001);
    assertEquals(expectedNzSign * 0.4472135955, hit.normal().z(), 0.000001);
  }

  private static String ramp(String id, double x, double z, String forward) {
    return "{\"id\":\"" + id + "\",\"type\":\"RAMP\",\"origin\":[" + x + ",0," + z
        + "],\"width\":2,\"run\":4,\"rise\":2,\"forward\":\"" + forward
        + "\",\"surface\":\"concrete\"}";
  }

  private static MapRuntime runtimeWith(String colliders) {
    String json = "{\"schemaVersion\":2,\"id\":\"physics-test\",\"revision\":1,\"units\":\"meter\","
        + "\"environment\":{\"theme\":\"test\",\"groundPrefab\":\"floor\",\"sky\":\"day\"},"
        + "\"bounds\":{\"type\":\"BOX\",\"center\":[15,5,0],\"size\":[50,10,30]},"
        + "\"colliders\":[" + colliders + "],\"visuals\":[],"
        + "\"spawnZones\":[{\"id\":\"ffa\",\"modes\":[\"FFA\"],\"team\":\"ANY\","
        + "\"candidates\":[{\"position\":[0,0,0],\"yaw\":0}],\"clearance\":1}],"
        + "\"pickups\":[],\"landmarks\":[]}";
    MapDefinition definition = new MapLoader(new ObjectMapper()).load(
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    return new MapRuntime(definition);
  }

  @Test
  void polygonBoundsInsetPlayerRadiusAlongDiagonalEdges() {
    String json = "{\"schemaVersion\":2,\"id\":\"polygon-test\",\"revision\":1,\"units\":\"meter\","
        + "\"environment\":{\"theme\":\"test\",\"groundPrefab\":\"floor\",\"sky\":\"day\"},"
        + "\"bounds\":{\"type\":\"POLYGON\",\"center\":[0,5,0],\"size\":[20,10,20],"
        + "\"vertices\":[[-8,-10],[8,-10],[10,-8],[10,8],[8,10],[-8,10],[-10,8],[-10,-8]]},"
        + "\"colliders\":[],\"visuals\":[],\"spawnZones\":[{\"id\":\"ffa\",\"modes\":[\"FFA\"],"
        + "\"team\":\"ANY\",\"candidates\":[{\"position\":[0,0,0],\"yaw\":0}],\"clearance\":1}],"
        + "\"pickups\":[],\"landmarks\":[]}";
    MapRuntime polygon = new MapRuntime(new MapLoader(new ObjectMapper()).load(
        new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8))));

    assertFalse(polygon.collides(0, MapRuntime.EYE_HEIGHT, 0));
    assertTrue(polygon.collides(9.8, MapRuntime.EYE_HEIGHT, 0));
    assertTrue(polygon.collides(9.6, MapRuntime.EYE_HEIGHT, 8.0));
    assertFalse(polygon.collides(9.2, MapRuntime.EYE_HEIGHT, 8.0));
  }
}
