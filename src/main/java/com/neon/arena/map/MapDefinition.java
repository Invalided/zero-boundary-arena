package com.neon.arena.map;

import java.util.List;

/**
 * 地图文件归一化后的 V2 内部模型。
 *
 * <p>运行时只允许依赖这个模型，不能再判断原始文件是 V1 还是 V2。这样旧格式的兼容成本
 * 被限制在加载阶段，碰撞、出生和射击等高频路径不会随着地图格式升级不断增加分支。</p>
 */
public record MapDefinition(
    int schemaVersion,
    String id,
    int revision,
    String units,
    Environment environment,
    Bounds bounds,
    double groundSize,
    List<Collider> colliders,
    List<Visual> visuals,
    List<SpawnZone> spawnZones,
    List<Pickup> pickups,
    List<Landmark> landmarks,
    List<NavigationNode> navigationNodes,
    String contentHash) {

  public record Vec2(double x, double y) {}

  public record Vec3(double x, double y, double z) {}

  public record Environment(
      String theme,
      String groundPrefab,
      String sky,
      Atmosphere atmosphere,
      SurfacePalette surfacePalette,
      Ground ground,
      List<FloorZone> floorZones,
      List<FloorDecal> floorDecals,
      List<WallSign> wallSigns,
      List<EnvironmentLight> lights) {}

  public record Atmosphere(
      String backgroundColor, String fogColor, double fogNear, double fogFar,
      String ambientSkyColor, String ambientGroundColor, double ambientIntensity,
      String mainLightColor, double mainLightIntensity, Vec3 mainLightPosition,
      String celestialColor, Vec3 celestialPosition, double celestialRadius,
      boolean stars, double exposure) {}

  public record SurfacePalette(
      String concrete, String metal, String wood, String ramp, String guide) {}

  public record Ground(
      String baseColor,
      String seamColor,
      String speckleColor,
      double panelMeters,
      double roughness,
      double metalness) {}

  public record FloorZone(
      String id,
      Vec2 center,
      Vec2 size,
      String color,
      String seamColor,
      String accentColor,
      String label,
      Vec2 labelPosition,
      double rotationY,
      double roughness,
      double metalness) {}

  public record FloorDecal(
      String id,
      String type,
      Vec2 center,
      Vec2 size,
      String color,
      double rotationY,
      double opacity) {}

  /** 墙面标牌通过边索引跟随多边形轮廓，地图布局调整后不需要手工重算世界旋转。 */
  public record WallSign(
      String id,
      int edgeIndex,
      String code,
      String title,
      String subtitle,
      String color,
      double width,
      double height,
      double verticalOffset) {}

  public record EnvironmentLight(
      String id, Vec3 position, String color, double intensity, double distance) {}

  /** POLYGON 顶点使用地图平面的 [x,z]，可顺时针或逆时针排列。 */
  public record Bounds(String type, Vec3 center, Vec3 size, List<Vec2> vertices) {}

  public sealed interface Collider permits BoxCollider, PlatformCollider, RampCollider {
    String id();
    String type();
    String surface();
  }

  public record BoxCollider(String id, String type, Vec3 center, Vec3 size, String surface)
      implements Collider {}

  public record PlatformCollider(
      String id, String type, Vec3 center, Vec3 size, boolean solid, String surface)
      implements Collider {}

  public record RampCollider(
      String id,
      String type,
      Vec3 origin,
      double width,
      double run,
      double rise,
      String forward,
      String surface) implements Collider {}

  public record Visual(
      String id,
      String prefab,
      Vec3 position,
      double rotationY,
      Vec3 scale,
      String variant,
      List<String> colliderRefs,
      Double cullDistance) {}

  public record SpawnZone(
      String id,
      List<String> modes,
      String team,
      List<SpawnCandidate> candidates,
      double clearance) {}

  public record SpawnCandidate(Vec3 position, double yaw) {}

  public record Pickup(
      String id, String weaponId, String itemType, Vec3 position,
      long respawnMinMs, long respawnMaxMs) {}

  public record Landmark(String id, String type, Vec3 position) {}

  public record NavigationNode(String id, Vec3 position, List<String> links) {}
}
