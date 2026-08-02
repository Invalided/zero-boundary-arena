package com.neon.arena.map;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/** 在服务启动阶段拒绝不完整或会产生不确定碰撞结果的地图。 */
@Component
public class MapValidator {
  private static final Set<String> SURFACES = Set.of("concrete", "metal", "wood", "glass", "ground", "soil", "energy");
  private static final Set<String> RAMP_DIRECTIONS = Set.of("POS_X", "NEG_X", "POS_Z", "NEG_Z");
  private static final Set<String> FLOOR_DECAL_TYPES = Set.of("WARNING_STRIPES", "ROUTE_ARROW");

  public void validate(MapDefinition map) {
    require(map.schemaVersion() == 2, "schemaVersion must be 2 after normalization");
    require(text(map.id()), "Map id is required");
    require(map.revision() > 0, "Map revision must be positive");
    require("meter".equals(map.units()), "Only meter units are supported");
    require(map.bounds() != null && Set.of("BOX", "POLYGON").contains(map.bounds().type()),
        "Bounds type must be BOX or POLYGON");
    require(finite(map.bounds().center()) && positive(map.bounds().size()), "Map bounds must be finite and positive");
    validatePolygonBounds(map.bounds());
    require(map.groundSize() > 0 && Double.isFinite(map.groundSize()), "groundSize must be positive");
    validateEnvironment(map);

    Set<String> colliderIds = new HashSet<>();
    for (MapDefinition.Collider collider : map.colliders()) {
      require(text(collider.id()) && colliderIds.add(collider.id()), "Collider ids must be unique and non-empty");
      require(SURFACES.contains(collider.surface()), "Unsupported surface: " + collider.surface());
      if (collider instanceof MapDefinition.BoxCollider box) {
        require(finite(box.center()) && positive(box.size()), "Invalid BOX collider: " + box.id());
        require(inside(map.bounds(), box.center()), "Collider outside map bounds: " + box.id());
      } else if (collider instanceof MapDefinition.PlatformCollider platform) {
        require(finite(platform.center()) && positive(platform.size()), "Invalid PLATFORM collider: " + platform.id());
        require(inside(map.bounds(), platform.center()), "Collider outside map bounds: " + platform.id());
      } else if (collider instanceof MapDefinition.RampCollider ramp) {
        require(finite(ramp.origin()) && positive(ramp.width(), ramp.run(), ramp.rise()),
            "Invalid RAMP collider: " + ramp.id());
        require(RAMP_DIRECTIONS.contains(ramp.forward()), "Invalid RAMP direction: " + ramp.forward());
        require(inside(map.bounds(), ramp.origin()), "Collider outside map bounds: " + ramp.id());
      }
    }

    Set<String> visualIds = new HashSet<>();
    for (MapDefinition.Visual visual : map.visuals()) {
      require(text(visual.id()) && visualIds.add(visual.id()), "Visual ids must be unique and non-empty");
      require(text(visual.prefab()), "Visual prefab is required: " + visual.id());
      require(finite(visual.position()) && positive(visual.scale()), "Invalid visual transform: " + visual.id());
      require(visual.colliderRefs().stream().allMatch(colliderIds::contains),
          "Visual references an unknown collider: " + visual.id());
      if (visual.cullDistance() != null) {
        require(Double.isFinite(visual.cullDistance()) && visual.cullDistance() > 0,
            "Visual cullDistance must be positive: " + visual.id());
        require(visual.colliderRefs().isEmpty(),
            "Only decoration without colliderRefs may use cullDistance: " + visual.id());
      }
    }

    Set<String> spawnIds = new HashSet<>();
    int candidateCount = 0;
    for (MapDefinition.SpawnZone zone : map.spawnZones()) {
      require(text(zone.id()) && spawnIds.add(zone.id()), "Spawn zone ids must be unique and non-empty");
      require(zone.clearance() >= 0 && Double.isFinite(zone.clearance()), "Invalid spawn clearance: " + zone.id());
      for (MapDefinition.SpawnCandidate candidate : zone.candidates()) {
        require(finite(candidate.position()) && Double.isFinite(candidate.yaw()), "Invalid spawn candidate: " + zone.id());
        require(inside(map.bounds(), candidate.position()), "Spawn outside map bounds: " + zone.id());
        candidateCount++;
      }
    }
    require(candidateCount > 0, "At least one spawn candidate is required");

    Set<String> pickupIds = new HashSet<>();
    for (MapDefinition.Pickup pickup : map.pickups()) {
      require(text(pickup.id()) && pickupIds.add(pickup.id()), "Pickup ids must be unique and non-empty");
      require(text(pickup.itemType()), "Pickup itemType is required: " + pickup.id());
      if("WEAPON".equalsIgnoreCase(pickup.itemType()))
        require(text(pickup.weaponId()), "Pickup weaponId is required: " + pickup.id());
      require(pickup.respawnMinMs()>0&&pickup.respawnMaxMs()>=pickup.respawnMinMs(),
          "Pickup respawn range is invalid: "+pickup.id());
      require(finite(pickup.position()) && inside(map.bounds(), pickup.position()),
          "Pickup outside map bounds: " + pickup.id());
    }

    Set<String> navigationIds = new HashSet<>();
    for (MapDefinition.NavigationNode node : map.navigationNodes()) {
      require(text(node.id()) && navigationIds.add(node.id()),
          "Navigation node ids must be unique and non-empty");
      require(finite(node.position()) && inside(map.bounds(), node.position()),
          "Navigation node outside map bounds: " + node.id());
    }
    for (MapDefinition.NavigationNode node : map.navigationNodes()) {
      require(node.links().stream().allMatch(navigationIds::contains),
          "Navigation node references an unknown link: " + node.id());
      require(node.links().stream().noneMatch(node.id()::equals),
          "Navigation node cannot link to itself: " + node.id());
    }
  }

  /**
   * 环境配置只影响客户端画面，但仍属于地图契约。启动阶段校验可以避免颜色拼写、负灯光距离或
   * 越界地面分区直到浏览器运行时才暴露，并确保服务端广播的地图 hash 对应一份可渲染配置。
   */
  private static void validateEnvironment(MapDefinition map) {
    MapDefinition.Environment environment = map.environment();
    require(environment != null && text(environment.theme()), "Environment theme is required");
    List<MapDefinition.FloorZone> zones = environment.floorZones();
    List<MapDefinition.FloorDecal> decals = environment.floorDecals();
    List<MapDefinition.WallSign> wallSigns = environment.wallSigns();
    List<MapDefinition.EnvironmentLight> lights = environment.lights();
    require(zones != null && decals != null && wallSigns != null && lights != null,
        "Environment collections must not be null");
    if (environment.atmosphere() != null) {
      MapDefinition.Atmosphere atmosphere = environment.atmosphere();
      require(color(atmosphere.backgroundColor()) && color(atmosphere.fogColor())
          && color(atmosphere.ambientSkyColor()) && color(atmosphere.ambientGroundColor())
          && color(atmosphere.mainLightColor()) && color(atmosphere.celestialColor()),
          "Atmosphere colors must use #RRGGBB");
      require(positive(atmosphere.fogNear(), atmosphere.fogFar(), atmosphere.celestialRadius(),
          atmosphere.exposure()) && atmosphere.fogFar() > atmosphere.fogNear(),
          "Invalid atmosphere distance or exposure");
      require(Double.isFinite(atmosphere.ambientIntensity()) && atmosphere.ambientIntensity() >= 0
          && Double.isFinite(atmosphere.mainLightIntensity()) && atmosphere.mainLightIntensity() >= 0
          && finite(atmosphere.mainLightPosition()) && finite(atmosphere.celestialPosition()),
          "Invalid atmosphere lighting");
    }
    if (environment.surfacePalette() != null) {
      MapDefinition.SurfacePalette palette = environment.surfacePalette();
      require(color(palette.concrete()) && color(palette.metal()) && color(palette.wood())
          && color(palette.ramp()) && color(palette.guide()),
          "Surface palette colors must use #RRGGBB");
    }
    if (environment.ground() != null) {
      MapDefinition.Ground ground = environment.ground();
      require(color(ground.baseColor()) && color(ground.seamColor()) && color(ground.speckleColor()),
          "Ground colors must use #RRGGBB");
      require(positive(ground.panelMeters()) && unit(ground.roughness()) && unit(ground.metalness()),
          "Invalid ground material values");
    }
    require(zones.isEmpty() || environment.ground() != null, "Floor zones require a ground definition");
    Set<String> wallSignIds = new HashSet<>();
    int edgeCount="POLYGON".equals(map.bounds().type())?map.bounds().vertices().size():4;
    for (MapDefinition.WallSign sign : wallSigns) {
      require(text(sign.id()) && wallSignIds.add(sign.id()),
          "Wall sign ids must be unique and non-empty");
      require(sign.edgeIndex()>=0 && sign.edgeIndex()<edgeCount,
          "Wall sign references an invalid boundary edge: " + sign.id());
      require(text(sign.code()) && text(sign.title()) && text(sign.subtitle()) && color(sign.color()),
          "Invalid wall sign content: " + sign.id());
      require(positive(sign.width(),sign.height()) && Double.isFinite(sign.verticalOffset())
          && sign.verticalOffset()>0, "Invalid wall sign size: " + sign.id());
    }
    Set<String> zoneIds = new HashSet<>();
    for (MapDefinition.FloorZone zone : zones) {
      require(text(zone.id()) && zoneIds.add(zone.id()), "Floor zone ids must be unique and non-empty");
      require(finite(zone.center()) && positive(zone.size()) && finite(zone.labelPosition()),
          "Invalid floor zone transform: " + zone.id());
      require(color(zone.color()) && color(zone.seamColor()) && color(zone.accentColor()),
          "Invalid floor zone color: " + zone.id());
      require(text(zone.label()) && Double.isFinite(zone.rotationY()), "Invalid floor zone label: " + zone.id());
      require(unit(zone.roughness()) && unit(zone.metalness()), "Invalid floor zone material: " + zone.id());
      require(insideFloor(map.bounds(), zone.center(), zone.size()), "Floor zone outside map bounds: " + zone.id());
    }
    Set<String> decalIds = new HashSet<>();
    for (MapDefinition.FloorDecal decal : decals) {
      require(text(decal.id()) && decalIds.add(decal.id()), "Floor decal ids must be unique and non-empty");
      require(FLOOR_DECAL_TYPES.contains(decal.type()), "Unsupported floor decal type: " + decal.type());
      require(finite(decal.center()) && positive(decal.size()) && insideFloor(map.bounds(), decal.center(), decal.size()),
          "Invalid floor decal transform: " + decal.id());
      require(color(decal.color()) && Double.isFinite(decal.rotationY()) && unit(decal.opacity()),
          "Invalid floor decal appearance: " + decal.id());
    }
    Set<String> lightIds = new HashSet<>();
    for (MapDefinition.EnvironmentLight light : lights) {
      require(text(light.id()) && lightIds.add(light.id()), "Environment light ids must be unique and non-empty");
      require(finite(light.position()) && inside(map.bounds(), light.position()),
          "Environment light outside map bounds: " + light.id());
      require(color(light.color()) && positive(light.intensity(), light.distance()),
          "Invalid environment light: " + light.id());
    }
  }

  private static boolean inside(MapDefinition.Bounds bounds, MapDefinition.Vec3 point) {
    MapDefinition.Vec3 c = bounds.center();
    MapDefinition.Vec3 s = bounds.size();
    return Math.abs(point.y() - c.y()) <= s.y() / 2
        && insideHorizontal(bounds, point.x(), point.z(), 0);
  }

  /**
   * 凸多边形的每条边都必须保持同一转向。运行时允许两种绕序，因此这里只拒绝转向改变、
   * 重合边和零面积；这样美术导出工具无需额外反转顶点数组。
   */
  private static void validatePolygonBounds(MapDefinition.Bounds bounds) {
    if (!"POLYGON".equals(bounds.type())) return;
    List<MapDefinition.Vec2> vertices = bounds.vertices();
    require(vertices != null && vertices.size() >= 3, "POLYGON bounds require at least 3 vertices");
    require(vertices.stream().allMatch(MapValidator::finite), "POLYGON vertices must be finite");
    double orientation = 0;
    for (int i = 0; i < vertices.size(); i++) {
      MapDefinition.Vec2 a = vertices.get(i);
      MapDefinition.Vec2 b = vertices.get((i + 1) % vertices.size());
      MapDefinition.Vec2 c = vertices.get((i + 2) % vertices.size());
      require(Math.hypot(b.x() - a.x(), b.y() - a.y()) > 1e-6,
          "POLYGON bounds contain a zero-length edge");
      double cross = (b.x() - a.x()) * (c.y() - b.y())
          - (b.y() - a.y()) * (c.x() - b.x());
      if (Math.abs(cross) <= 1e-7) continue;
      if (orientation == 0) orientation = Math.signum(cross);
      require(Math.signum(cross) == orientation, "POLYGON bounds must be convex and ordered");
    }
    require(orientation != 0, "POLYGON bounds must have non-zero area");
  }

  static boolean insideHorizontal(MapDefinition.Bounds bounds, double x, double z, double radius) {
    if (!"POLYGON".equals(bounds.type())) {
      return Math.abs(x - bounds.center().x()) <= bounds.size().x() / 2 - radius
          && Math.abs(z - bounds.center().z()) <= bounds.size().z() / 2 - radius;
    }
    List<MapDefinition.Vec2> vertices = bounds.vertices();
    double area2 = 0;
    for (int i = 0; i < vertices.size(); i++) {
      MapDefinition.Vec2 a = vertices.get(i), b = vertices.get((i + 1) % vertices.size());
      area2 += a.x() * b.y() - b.x() * a.y();
    }
    double orientation = Math.signum(area2);
    for (int i = 0; i < vertices.size(); i++) {
      MapDefinition.Vec2 a = vertices.get(i), b = vertices.get((i + 1) % vertices.size());
      double ex = b.x() - a.x(), ez = b.y() - a.y();
      double signedDistance = orientation * (ex * (z - a.y()) - ez * (x - a.x()))
          / Math.hypot(ex, ez);
      if (signedDistance < radius - 1e-7) return false;
    }
    return true;
  }

  private static boolean finite(MapDefinition.Vec3 value) {
    return value != null && Double.isFinite(value.x()) && Double.isFinite(value.y()) && Double.isFinite(value.z());
  }

  private static boolean finite(MapDefinition.Vec2 value) {
    return value != null && Double.isFinite(value.x()) && Double.isFinite(value.y());
  }

  private static boolean positive(MapDefinition.Vec2 value) {
    return finite(value) && positive(value.x(), value.y());
  }

  private static boolean insideFloor(
      MapDefinition.Bounds bounds, MapDefinition.Vec2 center, MapDefinition.Vec2 size) {
    double halfX = size.x() / 2, halfZ = size.y() / 2;
    return insideHorizontal(bounds, center.x() - halfX, center.y() - halfZ, 0)
        && insideHorizontal(bounds, center.x() + halfX, center.y() - halfZ, 0)
        && insideHorizontal(bounds, center.x() + halfX, center.y() + halfZ, 0)
        && insideHorizontal(bounds, center.x() - halfX, center.y() + halfZ, 0);
  }

  private static boolean positive(MapDefinition.Vec3 value) {
    return finite(value) && positive(value.x(), value.y(), value.z());
  }

  private static boolean positive(double... values) {
    for (double value : values) if (!Double.isFinite(value) || value <= 0) return false;
    return true;
  }

  private static boolean text(String value) {
    return value != null && !value.isBlank();
  }

  private static boolean color(String value) {
    return value != null && value.matches("#[0-9a-fA-F]{6}");
  }

  private static boolean unit(double value) {
    return Double.isFinite(value) && value >= 0 && value <= 1;
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new IllegalArgumentException(message);
  }
}
