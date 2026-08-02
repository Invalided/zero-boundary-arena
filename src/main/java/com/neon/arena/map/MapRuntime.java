package com.neon.arena.map;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.random.RandomGenerator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 服务端权威地图运行时。BOX、PLATFORM 和四向 RAMP 已统一参与地面、移动与射线结算。
 * RAMP 按有限斜平面求交，不能用整块包围盒代替，否则坡道上方的有效枪线会被错误阻挡。
 */
@Component
public class MapRuntime {
  public static final double PLAYER_RADIUS = 0.45;
  public static final double PLAYER_HEIGHT = 1.70;
  public static final double EYE_HEIGHT = 1.70;
  public static final double STEP_HEIGHT = 0.30;
  public static final double GROUND_SNAP = 0.15;
  private static final double EPSILON = 1e-6;

  private final MapDefinition definition;
  private final List<MapDefinition.BoxCollider> boxes;
  private final List<MapDefinition.PlatformCollider> platforms;
  private final List<MapDefinition.RampCollider> ramps;
  private final List<MapDefinition.SpawnCandidate> spawns;
  private final List<RuntimeItem> items;
  private final List<MapDefinition.NavigationNode> navigationNodes;
  private final Map<String,MapDefinition.NavigationNode> navigationById;
  private final Map<String,Map<String,String>> navigationNextHop;

  @Autowired
  public MapRuntime(ActiveMap activeMap) {
    this(activeMap.definition());
  }

  public MapRuntime(MapDefinition definition) {
    this.definition = definition;
    this.boxes = definition.colliders().stream()
        .filter(MapDefinition.BoxCollider.class::isInstance)
        .map(MapDefinition.BoxCollider.class::cast)
        .toList();
    this.platforms = definition.colliders().stream()
        .filter(MapDefinition.PlatformCollider.class::isInstance)
        .map(MapDefinition.PlatformCollider.class::cast)
        .toList();
    this.ramps = definition.colliders().stream()
        .filter(MapDefinition.RampCollider.class::isInstance)
        .map(MapDefinition.RampCollider.class::cast)
        .toList();
    this.spawns = definition.spawnZones().stream().flatMap(zone -> zone.candidates().stream()).toList();
    this.items = definition.pickups().stream()
        .map(item -> new RuntimeItem(item.id(),item.weaponId(),item.itemType(),item.position().x(),item.position().z(),item.respawnMinMs(),item.respawnMaxMs()))
        .toList();
    this.navigationNodes = definition.navigationNodes();
    Map<String,MapDefinition.NavigationNode> indexedNavigation=new LinkedHashMap<>();
    navigationNodes.forEach(node->indexedNavigation.put(node.id(),node));
    this.navigationById=Map.copyOf(indexedNavigation);
    this.navigationNextHop = buildNavigationRoutes(navigationNodes);
  }

  public String id() { return definition.id(); }
  public int revision() { return definition.revision(); }
  public String contentHash() { return definition.contentHash(); }
  public MapMetadata metadata() { return new MapMetadata(id(), revision(), contentHash()); }
  public MapDefinition definition() { return definition; }

  /**
   * Returns the next map-authored waypoint only when a direct ground-level route is obstructed.
   * Routes are precomputed once when the room loads, so the per-tick work is limited to a few
   * short ray probes and nearest-node comparisons.
   */
  public NavigationWaypoint nextNavigationWaypoint(
      double x,double z,double targetX,double targetZ) {
    if (navigationNodes.isEmpty() || clearGroundPath(x,z,targetX,targetZ)) return null;
    MapDefinition.NavigationNode start=nearestVisibleNavigationNode(x,z);
    MapDefinition.NavigationNode goal=nearestVisibleNavigationNode(targetX,targetZ);
    if(start==null||goal==null)return null;
    MapDefinition.NavigationNode selected=start;
    if(Math.hypot(x-start.position().x(),z-start.position().z())<1.6){
      String nextId=navigationNextHop.getOrDefault(start.id(),Map.of()).get(goal.id());
      if(nextId!=null)selected=navigationById.getOrDefault(nextId,start);
    }
    return new NavigationWaypoint(selected.id(),selected.position().x(),selected.position().z());
  }

  private MapDefinition.NavigationNode nearestVisibleNavigationNode(double x,double z){
    MapDefinition.NavigationNode best=null;double bestDistance=Double.POSITIVE_INFINITY;
    for(MapDefinition.NavigationNode node:navigationNodes){
      double distance=Math.hypot(node.position().x()-x,node.position().z()-z);
      if(distance<bestDistance&&clearGroundPath(x,z,node.position().x(),node.position().z())){
        best=node;bestDistance=distance;
      }
    }
    return best;
  }

  private boolean clearGroundPath(double x,double z,double targetX,double targetZ){
    double dx=targetX-x,dz=targetZ-z,distance=Math.hypot(dx,dz);
    if(distance<.2)return true;
    return !firstObstacleHit(x,.98,z,dx/distance,0,dz/distance,Math.max(.05,distance-.2)).hit();
  }

  private static Map<String,Map<String,String>> buildNavigationRoutes(
      List<MapDefinition.NavigationNode> nodes){
    Map<String,List<String>> graph=new LinkedHashMap<>();
    nodes.forEach(node->graph.put(node.id(),new ArrayList<>()));
    for(MapDefinition.NavigationNode node:nodes)for(String link:node.links()){
      graph.get(node.id()).add(link);
      graph.get(link).add(node.id());
    }
    Map<String,Map<String,String>> routes=new HashMap<>();
    for(String source:graph.keySet()){
      Map<String,String> firstHop=new HashMap<>();
      ArrayDeque<String> queue=new ArrayDeque<>();queue.add(source);firstHop.put(source,source);
      while(!queue.isEmpty()){
        String current=queue.removeFirst();
        for(String next:graph.get(current))if(!firstHop.containsKey(next)){
          firstHop.put(next,current.equals(source)?next:firstHop.get(current));queue.addLast(next);
        }
      }
      routes.put(source,Map.copyOf(firstHop));
    }
    return Map.copyOf(routes);
  }

  /** Player.y 始终是眼睛高度；碰撞前显式换算成脚底和头顶，避免一个 y 混用三种语义。 */
  public boolean collides(double x, double eyeY, double z) {
    if (!insideBounds(x, z, PLAYER_RADIUS)) return true;
    for (MapDefinition.BoxCollider box : boxes)
      if (overlapsSolidBox(x, eyeY, z, box.center(), box.size())) return true;
    for (MapDefinition.PlatformCollider platform : platforms)
      if (platform.solid() && overlapsSolidBox(x, eyeY, z, platform.center(), platform.size())) return true;
    for (MapDefinition.RampCollider ramp : ramps)
      if (overlapsSolidRamp(x, eyeY, z, ramp)) return true;
    return false;
  }

  /**
   * 查询当前位置可以接触的最高地面。maxRise 用于跨台阶或沿坡上行，maxDrop 用于贴地吸附；
   * 调用者必须根据运动方向传入范围，因此位于平台下方的玩家不会被错误吸到平台顶面。
   */
  public GroundHit groundHeight(
      double x, double z, double currentFeetY, double maxRise, double maxDrop) {
    return groundBetween(x, z, currentFeetY + maxRise, currentFeetY - maxDrop);
  }

  /**
   * 结算单个 Tick 的垂直运动。下降时只接受当前脚底以下、且本 Tick 确实跨过的表面；
   * 这条约束同时支持从上方落上平台，并杜绝玩家从平台下方被吸附上去。
   */
  public VerticalMove resolveVertical(
      double x, double z, double eyeY, double verticalVelocity, double dt) {
    double currentFeetY = eyeY - EYE_HEIGHT;
    double nextEyeY = eyeY + verticalVelocity * dt;
    if (verticalVelocity > 0) {
      double ceiling = firstCeilingBetween(x, z, eyeY, nextEyeY);
      if (!Double.isNaN(ceiling))
        return new VerticalMove(ceiling - EPSILON, 0, false);
      return new VerticalMove(nextEyeY, verticalVelocity, false);
    }

    double nextFeetY = nextEyeY - EYE_HEIGHT;
    GroundHit ground = groundBetween(x, z, currentFeetY + EPSILON, nextFeetY - GROUND_SNAP);
    if (ground.hit()) return new VerticalMove(ground.height() + EYE_HEIGHT, 0, true);
    return new VerticalMove(nextEyeY, verticalVelocity, false);
  }

  private double firstCeilingBetween(double x, double z, double currentTop, double nextTop) {
    double nearest = Double.NaN;
    for (MapDefinition.BoxCollider box : boxes)
      nearest = nearerCeiling(x, z, currentTop, nextTop, box.center(), box.size(), nearest);
    for (MapDefinition.PlatformCollider platform : platforms)
      if (platform.solid())
        nearest = nearerCeiling(
            x, z, currentTop, nextTop, platform.center(), platform.size(), nearest);
    return nearest;
  }

  private static double nearerCeiling(
      double x, double z, double currentTop, double nextTop,
      MapDefinition.Vec3 center, MapDefinition.Vec3 size, double nearest) {
    boolean insideX = Math.abs(x - center.x()) < size.x() / 2 + PLAYER_RADIUS;
    boolean insideZ = Math.abs(z - center.z()) < size.z() / 2 + PLAYER_RADIUS;
    double bottom = center.y() - size.y() / 2;
    if (!insideX || !insideZ || currentTop > bottom + EPSILON || nextTop < bottom - EPSILON)
      return nearest;
    return Double.isNaN(nearest) || bottom < nearest ? bottom : nearest;
  }

  private GroundHit groundBetween(double x, double z, double highest, double lowest) {
    GroundHit best = GroundHit.miss();
    if (insideBounds(x, z) && 0 <= highest + EPSILON && 0 >= lowest - EPSILON)
      best = new GroundHit(true, 0, "world-ground", "ground");
    for (MapDefinition.BoxCollider box : boxes) {
      double top = box.center().y() + box.size().y() / 2;
      if (insideTop(x, z, box.center(), box.size()) && inRange(top, highest, lowest)
          && (!best.hit() || top > best.height()))
        best = new GroundHit(true, top, box.id(), box.surface());
    }
    for (MapDefinition.PlatformCollider platform : platforms) {
      double top = platform.center().y() + platform.size().y() / 2;
      if (insideTop(x, z, platform.center(), platform.size()) && inRange(top, highest, lowest)
          && (!best.hit() || top > best.height()))
        best = new GroundHit(true, top, platform.id(), platform.surface());
    }
    for (MapDefinition.RampCollider ramp : ramps) {
      double height = rampHeight(ramp, x, z);
      if (!Double.isNaN(height) && inRange(height, highest, lowest)
          && (!best.hit() || height > best.height()))
        best = new GroundHit(true, height, ramp.id(), ramp.surface());
    }
    return best;
  }

  private boolean insideBounds(double x, double z) {
    return insideBounds(x, z, 0);
  }

  /** Projectile systems use the same authoritative horizontal boundary as players. */
  public boolean containsHorizontal(double x,double z){return insideBounds(x,z);}

  private boolean insideBounds(double x, double z, double radius) {
    return MapValidator.insideHorizontal(definition.bounds(), x, z, radius);
  }

  private static boolean inRange(double value, double highest, double lowest) {
    return value <= highest + EPSILON && value >= lowest - EPSILON;
  }

  private static boolean insideTop(
      double x, double z, MapDefinition.Vec3 center, MapDefinition.Vec3 size) {
    // 圆柱脚底只要仍覆盖顶面就可获得支撑；否则 solid 平台扩张后的侧面会让玩家永远踏不上边缘。
    return Math.abs(x - center.x()) <= size.x() / 2 + PLAYER_RADIUS
        && Math.abs(z - center.z()) <= size.z() / 2 + PLAYER_RADIUS;
  }

  private static boolean overlapsSolidBox(
      double x, double eyeY, double z, MapDefinition.Vec3 center, MapDefinition.Vec3 size) {
    boolean insideX = Math.abs(x - center.x()) < size.x() / 2 + PLAYER_RADIUS;
    boolean insideZ = Math.abs(z - center.z()) < size.z() / 2 + PLAYER_RADIUS;
    double feetY = eyeY - EYE_HEIGHT;
    double playerTop = feetY + PLAYER_HEIGHT;
    double boxBottom = center.y() - size.y() / 2;
    double boxTop = center.y() + size.y() / 2;
    return insideX && insideZ && feetY < boxTop - EPSILON && playerTop > boxBottom + EPSILON;
  }

  /**
   * RAMP 不只是可站立的无限薄斜面，斜面下方还是一个实体楔体。把玩家圆柱中心投影到
   * 坡道局部坐标后，以半径扩张有限矩形，并用最近的沿坡位置求楔体高度：站在斜面上
   * 时脚底等于表面不会被阻挡，从侧面接近中高段时则会撞到楔体侧壁。
   */
  private static boolean overlapsSolidRamp(
      double x, double eyeY, double z, MapDefinition.RampCollider ramp) {
    double along;
    double across;
    switch (ramp.forward()) {
      case "POS_X" -> { along = x - ramp.origin().x(); across = z - ramp.origin().z(); }
      case "NEG_X" -> { along = ramp.origin().x() - x; across = z - ramp.origin().z(); }
      case "POS_Z" -> { along = z - ramp.origin().z(); across = x - ramp.origin().x(); }
      case "NEG_Z" -> { along = ramp.origin().z() - z; across = x - ramp.origin().x(); }
      default -> { return false; }
    }
    double nearestAlong = clampValue(along, 0, ramp.run());
    double nearestAcross = clampValue(across, -ramp.width() / 2, ramp.width() / 2);
    double distanceAlong = along - nearestAlong;
    double distanceAcross = across - nearestAcross;
    if (distanceAlong * distanceAlong + distanceAcross * distanceAcross
        >= PLAYER_RADIUS * PLAYER_RADIUS) return false;
    double surface = ramp.origin().y() + ramp.rise() * nearestAlong / ramp.run();
    double feetY = eyeY - EYE_HEIGHT;
    double playerTop = feetY + PLAYER_HEIGHT;
    return surface > ramp.origin().y() + EPSILON
        && feetY < surface - EPSILON && playerTop > ramp.origin().y() + EPSILON;
  }

  private static double clampValue(double value, double min, double max) {
    return Math.max(min, Math.min(max, value));
  }

  /** RAMP 的 origin 是低端边缘中心，forward 方向是上坡方向。 */
  private static double rampHeight(MapDefinition.RampCollider ramp, double x, double z) {
    double along;
    double across;
    switch (ramp.forward()) {
      case "POS_X" -> { along = x - ramp.origin().x(); across = z - ramp.origin().z(); }
      case "NEG_X" -> { along = ramp.origin().x() - x; across = z - ramp.origin().z(); }
      case "POS_Z" -> { along = z - ramp.origin().z(); across = x - ramp.origin().x(); }
      case "NEG_Z" -> { along = ramp.origin().z() - z; across = x - ramp.origin().x(); }
      default -> { return Double.NaN; }
    }
    if (along < -EPSILON || along > ramp.run() + EPSILON
        || Math.abs(across) > ramp.width() / 2 + EPSILON) return Double.NaN;
    double progress = Math.max(0, Math.min(1, along / ramp.run()));
    return ramp.origin().y() + ramp.rise() * progress;
  }

  public double firstObstacleDistance(
      double ox, double oy, double oz, double dx, double dy, double dz, double maxDistance) {
    return firstObstacleHit(ox, oy, oz, dx, dy, dz, maxDistance).distance();
  }

  /**
   * AABB slab 算法会分别求射线进入/离开 X、Y、Z 三组平面的参数区间；三个区间仍有
   * 交集时才命中。除了距离，还保留碰撞体、材质、命中点与法线，后续弹孔无需客户端猜测。
   */
  public RayHit firstObstacleHit(
      double ox, double oy, double oz, double dx, double dy, double dz, double maxDistance) {
    RayHit nearest = RayHit.miss(maxDistance, ox, oy, oz, dx, dy, dz);
    for (MapDefinition.BoxCollider box : boxes) {
      RayHit hit = rayAabb(ox, oy, oz, dx, dy, dz,
          box.id(), box.surface(), box.center(), box.size(), nearest.distance());
      if (hit != null && hit.distance() < nearest.distance()) nearest = hit;
    }
    for (MapDefinition.PlatformCollider platform : platforms) {
      if (!platform.solid()) continue;
      RayHit hit = rayAabb(ox, oy, oz, dx, dy, dz,
          platform.id(), platform.surface(), platform.center(), platform.size(), nearest.distance());
      if (hit != null && hit.distance() < nearest.distance()) nearest = hit;
    }
    for (MapDefinition.RampCollider ramp : ramps) {
      RayHit hit = rayRamp(ox, oy, oz, dx, dy, dz, ramp, nearest.distance());
      if (hit != null && hit.distance() < nearest.distance()) nearest = hit;
    }
    return nearest;
  }

  public double[] randomSpawn() {
    return randomSpawn(ThreadLocalRandom.current());
  }

  double[] randomSpawn(RandomGenerator random) {
    MapDefinition.SpawnCandidate spawn = spawns.get(random.nextInt(spawns.size()));
    // V1 的实际行为是每个候选点周围 ±1m 抖动；V2 安全出生评分将在房间接入玩家上下文后实现。
    // 出生位置和朝向必须作为同一个原子结果返回。只传 x/z 会让 Player 丢失地图设计的
    // 面向角，客户端随后只能沿用上一次视角，产生“出生后先看外墙”的不一致体验。
    return new double[] {spawn.position().x() + random.nextDouble(-1, 1),
        spawn.position().z() + random.nextDouble(-1, 1), spawn.yaw()};
  }

  public List<RuntimeItem> items() { return items; }

  private static RayHit rayAabb(
      double ox, double oy, double oz, double dx, double dy, double dz,
      String colliderId, String surface, MapDefinition.Vec3 boxCenter,
      MapDefinition.Vec3 boxSize, double maxDistance) {
    double[] origin = {ox, oy, oz};
    double[] direction = {dx, dy, dz};
    double[] center = {boxCenter.x(), boxCenter.y(), boxCenter.z()};
    double[] size = {boxSize.x(), boxSize.y(), boxSize.z()};
    double enter = 0;
    double exit = maxDistance;
    int enterAxis = -1;
    double enterNormal = 0;
    for (int axis = 0; axis < 3; axis++) {
      double min = center[axis] - size[axis] / 2;
      double max = center[axis] + size[axis] / 2;
      if (Math.abs(direction[axis]) < 1e-9) {
        if (origin[axis] < min || origin[axis] > max) return null;
        continue;
      }
      double first = (min - origin[axis]) / direction[axis];
      double second = (max - origin[axis]) / direction[axis];
      double normal = -Math.signum(direction[axis]);
      if (first > second) {
        double swap = first; first = second; second = swap;
      }
      if (first > enter) {
        enter = first;
        enterAxis = axis;
        enterNormal = normal;
      }
      exit = Math.min(exit, second);
      if (exit < enter) return null;
    }
    if (enter < 0 || enter > maxDistance) return null;
    double nx = enterAxis == 0 ? enterNormal : 0;
    double ny = enterAxis == 1 ? enterNormal : 0;
    double nz = enterAxis == 2 ? enterNormal : 0;
    return new RayHit(true, colliderId, surface, enter,
        new MapDefinition.Vec3(ox + dx * enter, oy + dy * enter, oz + dz * enter),
        new MapDefinition.Vec3(nx, ny, nz));
  }

  /**
   * 求射线与坡道顶面的精确交点。先把四种朝向统一成水平 forward 向量，再解斜平面方程；
   * 得到交点后还要检查它是否落在 [0, run] 和 [-width/2, width/2] 内，避免无限平面误挡子弹。
   */
  private static RayHit rayRamp(
      double ox, double oy, double oz, double dx, double dy, double dz,
      MapDefinition.RampCollider ramp, double maxDistance) {
    double fx;
    double fz;
    switch (ramp.forward()) {
      case "POS_X" -> { fx = 1; fz = 0; }
      case "NEG_X" -> { fx = -1; fz = 0; }
      case "POS_Z" -> { fx = 0; fz = 1; }
      case "NEG_Z" -> { fx = 0; fz = -1; }
      default -> { return null; }
    }

    double slope = ramp.rise() / ramp.run();
    double originAlong = (ox - ramp.origin().x()) * fx + (oz - ramp.origin().z()) * fz;
    double planeAtOrigin = oy - ramp.origin().y() - slope * originAlong;
    double denominator = dy - slope * (dx * fx + dz * fz);
    if (Math.abs(denominator) < 1e-9) return null;

    double distance = -planeAtOrigin / denominator;
    if (distance < -EPSILON || distance > maxDistance + EPSILON) return null;
    distance = Math.max(0, distance);

    double px = ox + dx * distance;
    double py = oy + dy * distance;
    double pz = oz + dz * distance;
    double along = (px - ramp.origin().x()) * fx + (pz - ramp.origin().z()) * fz;
    // forward 的水平垂线即坡宽方向，符号不影响对称的宽度裁剪。
    double across = (px - ramp.origin().x()) * -fz + (pz - ramp.origin().z()) * fx;
    if (along < -EPSILON || along > ramp.run() + EPSILON
        || Math.abs(across) > ramp.width() / 2 + EPSILON) return null;

    double nx = -slope * fx;
    double ny = 1;
    double nz = -slope * fz;
    double normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
    // 同一个斜面允许从上下两侧命中；返回的法线统一迎向入射射线，便于客户端贴弹孔。
    if (nx * dx + ny * dy + nz * dz > 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    return new RayHit(true, ramp.id(), ramp.surface(), distance,
        new MapDefinition.Vec3(px, py, pz), new MapDefinition.Vec3(nx, ny, nz));
  }

  public record RuntimeItem(String id,String weaponId,String itemType,double x,double z,long respawnMinMs,long respawnMaxMs) {
    public RuntimeItem(String id,String weaponId,double x,double z){this(id,weaponId,"WEAPON",x,z,10_000,10_000);}
  }
  public record NavigationWaypoint(String id,double x,double z) {}
  public record MapMetadata(String id, int revision, String contentHash) {}
  public record GroundHit(boolean hit, double height, String colliderId, String surface) {
    private static GroundHit miss() { return new GroundHit(false, Double.NaN, null, null); }
  }
  public record VerticalMove(double eyeY, double verticalVelocity, boolean onGround) {}
  public record RayHit(
      boolean hit,
      String colliderId,
      String surface,
      double distance,
      MapDefinition.Vec3 point,
      MapDefinition.Vec3 normal) {
    private static RayHit miss(
        double distance, double ox, double oy, double oz, double dx, double dy, double dz) {
      return new RayHit(false, null, null, distance,
          new MapDefinition.Vec3(ox + dx * distance, oy + dy * distance, oz + dz * distance),
          new MapDefinition.Vec3(0, 0, 0));
    }
  }
}
