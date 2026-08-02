package com.neon.arena.map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class MapLoaderTest {
  private final MapLoader loader = new MapLoader(new ObjectMapper());

  @Test
  void loadsCurrentNativeV2Arena() {
    MapDefinition map = loader.loadClasspath("/static/maps/arena.json");

    assertEquals(2, map.schemaVersion());
    assertEquals("neon-arena", map.id());
    assertEquals(16, map.revision());
    assertEquals(37, map.colliders().size());
    assertEquals(55, map.visuals().size());
    assertEquals(5, map.environment().floorZones().size());
    assertEquals(7, map.environment().floorDecals().size());
    assertEquals(9, map.environment().lights().size());
    assertTrue(map.environment().atmosphere().stars());
    assertEquals("#273b55",map.environment().surfacePalette().metal());
    assertEquals(4, map.environment().ground().panelMeters());
    assertEquals("zero-arena/core-v1", map.visuals().get(0).prefab());
    assertEquals("core-base", map.visuals().get(0).colliderRefs().get(0));
    assertEquals(8, map.spawnZones().get(0).candidates().size());
    assertEquals(14, map.pickups().size());
    assertEquals(8, map.navigationNodes().size());
    MapDefinition.BoxCollider center = assertInstanceOf(
        MapDefinition.BoxCollider.class, map.colliders().get(0));
    assertEquals(new MapDefinition.Vec3(0, 1.5, 0), center.center());
    assertInstanceOf(MapDefinition.PlatformCollider.class, map.colliders().stream()
        .filter(collider -> collider.id().equals("north-training-platform")).findFirst().orElseThrow());
    assertInstanceOf(MapDefinition.RampCollider.class, map.colliders().stream()
        .filter(collider -> collider.id().equals("north-training-ramp")).findFirst().orElseThrow());
    assertEquals("sniper", map.pickups().get(0).weaponId());
    assertEquals("MEDKIT_SMALL",map.pickups().get(3).itemType());
    assertEquals(20_000,map.pickups().get(3).respawnMinMs());
  }

  @Test
  void loadsPolygonArenaGraybox() {
    MapDefinition map = loader.loadClasspath("/static/maps/polygon-arena.json");

    assertEquals("zero-polygon-arena", map.id());
    assertEquals("POLYGON", map.bounds().type());
    assertEquals(17,map.revision());
    assertEquals("energy_relay_station_day",map.environment().theme());
    assertFalse(map.environment().atmosphere().stars());
    assertEquals("#729db4",map.environment().atmosphere().backgroundColor());
    assertEquals(5,map.environment().floorZones().size());
    assertEquals(6,map.environment().floorDecals().size());
    assertEquals(4,map.environment().wallSigns().size());
    assertEquals(12, map.bounds().vertices().size());
    assertEquals(43, map.colliders().size());
    assertEquals(25, map.visuals().size());
    assertEquals(12, map.spawnZones().get(0).candidates().size());
    assertEquals(14, map.pickups().size());
    assertEquals("ARMOR_VEST",map.pickups().get(4).itemType());
    assertEquals(8,map.navigationNodes().size());
  }

  @Test
  void normalizesLegacyV1MapIntoV2() {
    String source = "{\"id\":\"legacy\",\"limit\":10,\"groundSize\":20,"
        + "\"obstacles\":[{\"x\":1,\"z\":2,\"width\":3,\"height\":4,\"depth\":5,\"surface\":\"metal\"}],"
        + "\"spawns\":[{\"x\":-2,\"z\":-3}],"
        + "\"pickups\":[{\"id\":\"gun\",\"weapon\":\"m4a1\",\"x\":4,\"z\":5}]}";

    MapDefinition map = loader.load(stream(source));

    assertEquals(2, map.schemaVersion());
    assertEquals(1, map.revision());
    assertEquals(new MapDefinition.Vec3(1, 2, 2),
        assertInstanceOf(MapDefinition.BoxCollider.class, map.colliders().get(0)).center());
    assertEquals(new MapDefinition.Vec3(-2, 0, -3),
        map.spawnZones().get(0).candidates().get(0).position());
    assertEquals("m4a1", map.pickups().get(0).weaponId());
  }

  @Test
  void rejectsFutureSchemaVersions() {
    String source = validV2("future").replace("\"schemaVersion\":2", "\"schemaVersion\":3");
    assertThrows(IllegalArgumentException.class, () -> loader.load(stream(source)));
  }

  @Test
  void contentHashUsesOriginalUtf8Bytes() throws Exception {
    String source = validV2("hash-map");
    String expected = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
        .digest(source.getBytes(StandardCharsets.UTF_8)));

    MapDefinition map = loader.load(stream(source));

    assertEquals(expected, map.contentHash());
    assertEquals(64, map.contentHash().length());
  }

  @Test
  void parsesNativeV2BoxPlatformAndRamp() {
    String source = validV2("native-v2").replace("\"colliders\":[]", "\"colliders\":["
        + "{\"id\":\"box\",\"type\":\"BOX\",\"center\":[0,1,0],\"size\":[2,2,2],\"surface\":\"metal\"},"
        + "{\"id\":\"platform\",\"type\":\"PLATFORM\",\"center\":[3,2,0],\"size\":[2,0.3,2],\"solid\":true,\"surface\":\"metal\"},"
        + "{\"id\":\"ramp\",\"type\":\"RAMP\",\"origin\":[-3,0,0],\"width\":2,\"run\":4,\"rise\":2,\"forward\":\"POS_Z\",\"surface\":\"concrete\"}]");

    MapDefinition map = loader.load(stream(source));

    assertInstanceOf(MapDefinition.BoxCollider.class, map.colliders().get(0));
    assertInstanceOf(MapDefinition.PlatformCollider.class, map.colliders().get(1));
    assertInstanceOf(MapDefinition.RampCollider.class, map.colliders().get(2));
  }

  @Test
  void parsesAndValidatesConvexPolygonBounds() {
    String source = validV2("polygon").replace(
        "\"bounds\":{\"type\":\"BOX\",\"center\":[0,5,0],\"size\":[20,10,20]}",
        "\"bounds\":{\"type\":\"POLYGON\",\"center\":[0,5,0],\"size\":[20,10,20],"
            + "\"vertices\":[[-8,-10],[8,-10],[10,-8],[10,8],[8,10],[-8,10],[-10,8],[-10,-8]]}");

    MapDefinition map = loader.load(stream(source));

    assertEquals("POLYGON", map.bounds().type());
    assertEquals(8, map.bounds().vertices().size());
  }

  @Test
  void rejectsConcavePolygonBounds() {
    String source = validV2("concave").replace(
        "\"bounds\":{\"type\":\"BOX\",\"center\":[0,5,0],\"size\":[20,10,20]}",
        "\"bounds\":{\"type\":\"POLYGON\",\"center\":[0,5,0],\"size\":[20,10,20],"
            + "\"vertices\":[[-8,-8],[8,-8],[0,0],[8,8],[-8,8]]}");

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> loader.load(stream(source)));

    assertTrue(error.getMessage().contains("convex"));
  }

  @Test
  void rejectsDuplicateColliderIds() {
    String source = validV2("bad").replace("\"colliders\":[]", "\"colliders\":["
        + "{\"id\":\"same\",\"type\":\"BOX\",\"center\":[0,1,0],\"size\":[2,2,2],\"surface\":\"metal\"},"
        + "{\"id\":\"same\",\"type\":\"BOX\",\"center\":[4,1,0],\"size\":[2,2,2],\"surface\":\"metal\"}]");

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> loader.load(stream(source)));

    assertTrue(error.getMessage().contains("unique"));
  }

  private static ByteArrayInputStream stream(String value) {
    return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
  }

  private static String validV2(String id) {
    return "{\"schemaVersion\":2,\"id\":\"" + id + "\",\"revision\":1,\"units\":\"meter\","
        + "\"environment\":{\"theme\":\"test\",\"groundPrefab\":\"floor\",\"sky\":\"day\"},"
        + "\"bounds\":{\"type\":\"BOX\",\"center\":[0,5,0],\"size\":[20,10,20]},"
        + "\"colliders\":[],\"visuals\":[],"
        + "\"spawnZones\":[{\"id\":\"ffa\",\"modes\":[\"FFA\"],\"team\":\"ANY\","
        + "\"candidates\":[{\"position\":[0,0,0],\"yaw\":0}],\"clearance\":1}],"
        + "\"pickups\":[],\"landmarks\":[]}";
  }
}
