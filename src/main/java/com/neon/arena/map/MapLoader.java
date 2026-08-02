package com.neon.arena.map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** 将 V1/V2 地图 JSON 加载为唯一的 V2 内部结构。 */
@Component
public class MapLoader {
  private final ObjectMapper json;
  private final MapValidator validator;

  @Autowired
  public MapLoader(ObjectMapper json) {
    this(json, new MapValidator());
  }

  MapLoader(ObjectMapper json, MapValidator validator) {
    this.json = json;
    this.validator = validator;
  }

  public MapDefinition loadClasspath(String resourcePath) {
    return load(readClasspathBytes(resourcePath));
  }

  /**
   * 读取实际参与服务端运行的 classpath 资源。活动地图接口复用这些原始字节，避免开发目录中的
   * JSON 与已打包 JAR 内的 JSON 不一致，导致客户端画面和服务端碰撞使用两张地图。
   */
  public byte[] readClasspathBytes(String resourcePath) {
    try (InputStream input = MapLoader.class.getResourceAsStream(resourcePath)) {
      if (input == null) throw new IllegalStateException("Missing map resource: " + resourcePath);
      return input.readAllBytes();
    } catch (IOException error) {
      throw new IllegalStateException("Cannot read map resource: " + resourcePath, error);
    }
  }

  public MapDefinition load(byte[] sourceBytes) {
    return load(new ByteArrayInputStream(sourceBytes));
  }

  public MapDefinition load(InputStream input) {
    try {
      byte[] sourceBytes = input.readAllBytes();
      JsonNode source = json.readTree(sourceBytes);
      int schemaVersion = source.path("schemaVersion").asInt(1);
      if (schemaVersion != 1 && schemaVersion != 2) {
        throw new IllegalArgumentException("Unsupported map schemaVersion: " + schemaVersion);
      }
      ObjectNode normalized = schemaVersion == 1 ? normalizeV1(source)
          : requireObject(source, "Map document must be a JSON object");
      // 使用原始资源字节计算摘要，确保服务端与浏览器 SubtleCrypto 得到完全相同的结果。
      String contentHash = hash(sourceBytes);
      MapDefinition definition = parseV2(normalized, contentHash);
      validator.validate(definition);
      return definition;
    } catch (IOException error) {
      throw new IllegalArgumentException("Cannot parse map JSON", error);
    }
  }

  /**
   * V1 迁移只发生一次：地面 AABB 转为带 Y 中心的 BOX，离散出生点合并为一个出生区，
   * 二维道具补齐 Y=0。归一化完成后，运行时看不到任何 V1 字段。
   */
  private ObjectNode normalizeV1(JsonNode source) {
    ObjectNode target = json.createObjectNode();
    double limit = source.path("limit").asDouble();
    double groundSize = source.path("groundSize").asDouble(limit * 2);
    target.put("schemaVersion", 2);
    target.put("id", source.path("id").asText());
    target.put("revision", 1);
    target.put("units", "meter");
    target.putObject("environment").put("theme", "legacy_arena");
    ObjectNode bounds = target.putObject("bounds").put("type", "BOX");
    vector(bounds.putArray("center"), 0, 50, 0);
    vector(bounds.putArray("size"), limit * 2, 100, limit * 2);
    target.put("groundSize", groundSize);

    ArrayNode colliders = target.putArray("colliders");
    int obstacleIndex = 0;
    for (JsonNode obstacle : source.path("obstacles")) {
      double height = obstacle.path("height").asDouble();
      ObjectNode collider = colliders.addObject()
          .put("id", "legacy-box-" + (++obstacleIndex))
          .put("type", "BOX")
          .put("surface", obstacle.path("surface").asText("concrete"));
      vector(collider.putArray("center"), obstacle.path("x").asDouble(), height / 2,
          obstacle.path("z").asDouble());
      vector(collider.putArray("size"), obstacle.path("width").asDouble(), height,
          obstacle.path("depth").asDouble());
    }

    target.putArray("visuals");
    ObjectNode zone = target.putArray("spawnZones").addObject()
        .put("id", "legacy-ffa")
        .put("team", "ANY")
        .put("clearance", 1);
    zone.putArray("modes").add("FFA");
    ArrayNode candidates = zone.putArray("candidates");
    for (JsonNode spawn : source.path("spawns")) {
      ObjectNode candidate = candidates.addObject().put("yaw", 0);
      vector(candidate.putArray("position"), spawn.path("x").asDouble(), 0,
          spawn.path("z").asDouble());
    }

    ArrayNode pickups = target.putArray("pickups");
    for (JsonNode pickup : source.path("pickups")) {
      ObjectNode converted = pickups.addObject()
          .put("id", pickup.path("id").asText())
          .put("weaponId", pickup.path("weapon").asText());
      vector(converted.putArray("position"), pickup.path("x").asDouble(), 0,
          pickup.path("z").asDouble());
    }
    target.putArray("landmarks");
    target.putArray("navigationNodes");
    return target;
  }

  private MapDefinition parseV2(ObjectNode root, String hash) {
    List<MapDefinition.Collider> colliders = new ArrayList<>();
    for (JsonNode node : root.path("colliders")) {
      String type = node.path("type").asText();
      String id = node.path("id").asText();
      String surface = node.path("surface").asText();
      switch (type) {
        case "BOX" -> colliders.add(new MapDefinition.BoxCollider(id, type,
            vec(node.path("center")), vec(node.path("size")), surface));
        case "PLATFORM" -> colliders.add(new MapDefinition.PlatformCollider(id, type,
            vec(node.path("center")), vec(node.path("size")), node.path("solid").asBoolean(), surface));
        case "RAMP" -> colliders.add(new MapDefinition.RampCollider(id, type,
            vec(node.path("origin")), node.path("width").asDouble(), node.path("run").asDouble(),
            node.path("rise").asDouble(), node.path("forward").asText(), surface));
        default -> throw new IllegalArgumentException("Unsupported collider type: " + type);
      }
    }

    List<MapDefinition.Visual> visuals = new ArrayList<>();
    for (JsonNode node : root.path("visuals")) {
      visuals.add(new MapDefinition.Visual(node.path("id").asText(), node.path("prefab").asText(),
          vec(node.path("position")), node.path("rotationY").asDouble(), vec(node.path("scale")),
          node.path("variant").asText(), strings(node.path("colliderRefs")),
          node.has("cullDistance") ? node.path("cullDistance").asDouble(Double.NaN) : null));
    }

    List<MapDefinition.SpawnZone> spawnZones = new ArrayList<>();
    for (JsonNode node : root.path("spawnZones")) {
      List<MapDefinition.SpawnCandidate> candidates = new ArrayList<>();
      for (JsonNode candidate : node.path("candidates")) {
        candidates.add(new MapDefinition.SpawnCandidate(vec(candidate.path("position")),
            candidate.path("yaw").asDouble()));
      }
      spawnZones.add(new MapDefinition.SpawnZone(node.path("id").asText(), strings(node.path("modes")),
          node.path("team").asText(), List.copyOf(candidates), node.path("clearance").asDouble()));
    }

    List<MapDefinition.Pickup> pickups = new ArrayList<>();
    for (JsonNode node : root.path("pickups")) {
      String itemType=node.path("itemType").asText("WEAPON");
      com.neon.arena.game.WorldItemType type=com.neon.arena.game.WorldItemType.parse(itemType);
      pickups.add(new MapDefinition.Pickup(node.path("id").asText(),
          node.path("weaponId").asText(),type.name(),vec(node.path("position")),
          node.path("respawnMinMs").asLong(type.defaultRespawnMinMs()),
          node.path("respawnMaxMs").asLong(type.defaultRespawnMaxMs())));
    }
    List<MapDefinition.Landmark> landmarks = new ArrayList<>();
    for (JsonNode node : root.path("landmarks")) {
      landmarks.add(new MapDefinition.Landmark(node.path("id").asText(), node.path("type").asText(),
          vec(node.path("position"))));
    }
    List<MapDefinition.NavigationNode> navigationNodes = new ArrayList<>();
    for (JsonNode node : root.path("navigationNodes")) {
      navigationNodes.add(new MapDefinition.NavigationNode(node.path("id").asText(),
          vec(node.path("position")), strings(node.path("links"))));
    }

    JsonNode environment = root.path("environment");
    MapDefinition.Ground ground = null;
    if (environment.path("ground").isObject()) {
      JsonNode node = environment.path("ground");
      ground = new MapDefinition.Ground(node.path("baseColor").asText(), node.path("seamColor").asText(),
          node.path("speckleColor").asText(), node.path("panelMeters").asDouble(Double.NaN),
          node.path("roughness").asDouble(Double.NaN), node.path("metalness").asDouble(Double.NaN));
    }
    List<MapDefinition.FloorZone> floorZones = new ArrayList<>();
    for (JsonNode node : environment.path("floorZones")) {
      floorZones.add(new MapDefinition.FloorZone(node.path("id").asText(), vec2(node.path("center")),
          vec2(node.path("size")), node.path("color").asText(), node.path("seamColor").asText(),
          node.path("accentColor").asText(), node.path("label").asText(),
          vec2(node.path("labelPosition")), node.path("rotationY").asDouble(),
          node.path("roughness").asDouble(Double.NaN), node.path("metalness").asDouble(Double.NaN)));
    }
    List<MapDefinition.FloorDecal> floorDecals = new ArrayList<>();
    for (JsonNode node : environment.path("floorDecals")) {
      floorDecals.add(new MapDefinition.FloorDecal(node.path("id").asText(), node.path("type").asText(),
          vec2(node.path("center")), vec2(node.path("size")), node.path("color").asText(),
          node.path("rotationY").asDouble(), node.path("opacity").asDouble(Double.NaN)));
    }
    List<MapDefinition.WallSign> wallSigns = new ArrayList<>();
    for (JsonNode node : environment.path("wallSigns")) {
      wallSigns.add(new MapDefinition.WallSign(node.path("id").asText(),
          node.path("edgeIndex").asInt(-1), node.path("code").asText(),
          node.path("title").asText(), node.path("subtitle").asText(),
          node.path("color").asText(), node.path("width").asDouble(Double.NaN),
          node.path("height").asDouble(Double.NaN),
          node.path("verticalOffset").asDouble(Double.NaN)));
    }
    List<MapDefinition.EnvironmentLight> environmentLights = new ArrayList<>();
    for (JsonNode node : environment.path("lights")) {
      environmentLights.add(new MapDefinition.EnvironmentLight(node.path("id").asText(),
          vec(node.path("position")), node.path("color").asText(),
          node.path("intensity").asDouble(Double.NaN), node.path("distance").asDouble(Double.NaN)));
    }
    MapDefinition.Atmosphere atmosphere = null;
    if (environment.path("atmosphere").isObject()) {
      JsonNode node = environment.path("atmosphere");
      atmosphere = new MapDefinition.Atmosphere(
          node.path("backgroundColor").asText(), node.path("fogColor").asText(),
          node.path("fogNear").asDouble(Double.NaN), node.path("fogFar").asDouble(Double.NaN),
          node.path("ambientSkyColor").asText(), node.path("ambientGroundColor").asText(),
          node.path("ambientIntensity").asDouble(Double.NaN), node.path("mainLightColor").asText(),
          node.path("mainLightIntensity").asDouble(Double.NaN), vec(node.path("mainLightPosition")),
          node.path("celestialColor").asText(), vec(node.path("celestialPosition")),
          node.path("celestialRadius").asDouble(Double.NaN), node.path("stars").asBoolean(),
          node.path("exposure").asDouble(Double.NaN));
    }
    MapDefinition.SurfacePalette surfacePalette = null;
    if (environment.path("surfacePalette").isObject()) {
      JsonNode node = environment.path("surfacePalette");
      surfacePalette = new MapDefinition.SurfacePalette(node.path("concrete").asText(),
          node.path("metal").asText(), node.path("wood").asText(), node.path("ramp").asText(),
          node.path("guide").asText());
    }
    JsonNode bounds = root.path("bounds");
    return new MapDefinition(2, root.path("id").asText(), root.path("revision").asInt(),
        root.path("units").asText(), new MapDefinition.Environment(environment.path("theme").asText(),
        environment.path("groundPrefab").asText(), environment.path("sky").asText(), atmosphere,
        surfacePalette, ground,
        List.copyOf(floorZones), List.copyOf(floorDecals), List.copyOf(wallSigns),
        List.copyOf(environmentLights)),
        new MapDefinition.Bounds(bounds.path("type").asText(), vec(bounds.path("center")),
            vec(bounds.path("size")), vec2List(bounds.path("vertices"))),
        root.path("groundSize").asDouble(bounds.path("size").path(0).asDouble()),
        List.copyOf(colliders), List.copyOf(visuals), List.copyOf(spawnZones), List.copyOf(pickups),
        List.copyOf(landmarks), List.copyOf(navigationNodes), hash);
  }

  private static ObjectNode requireObject(JsonNode node, String message) {
    if (node == null || !node.isObject()) throw new IllegalArgumentException(message);
    return (ObjectNode) node;
  }

  private static MapDefinition.Vec3 vec(JsonNode node) {
    if (!node.isArray() || node.size() != 3) return new MapDefinition.Vec3(Double.NaN, Double.NaN, Double.NaN);
    return new MapDefinition.Vec3(node.get(0).asDouble(Double.NaN), node.get(1).asDouble(Double.NaN),
        node.get(2).asDouble(Double.NaN));
  }

  private static MapDefinition.Vec2 vec2(JsonNode node) {
    if (!node.isArray() || node.size() != 2) return new MapDefinition.Vec2(Double.NaN, Double.NaN);
    return new MapDefinition.Vec2(node.get(0).asDouble(Double.NaN), node.get(1).asDouble(Double.NaN));
  }

  private static List<String> strings(JsonNode node) {
    List<String> values = new ArrayList<>();
    if (node.isArray()) node.forEach(value -> values.add(value.asText()));
    return List.copyOf(values);
  }

  private static List<MapDefinition.Vec2> vec2List(JsonNode node) {
    List<MapDefinition.Vec2> values = new ArrayList<>();
    if (node.isArray()) node.forEach(value -> values.add(vec2(value)));
    return List.copyOf(values);
  }

  private static void vector(ArrayNode target, double x, double y, double z) {
    target.add(x).add(y).add(z);
  }

  private String hash(byte[] sourceBytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(sourceBytes));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("Cannot calculate map content hash", error);
    }
  }
}
