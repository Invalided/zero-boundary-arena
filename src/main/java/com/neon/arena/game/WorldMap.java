package com.neon.arena.game;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.map.MapLoader;
import com.neon.arena.map.MapRuntime;
import java.util.List;

/**
 * @deprecated 新代码应注入 {@link MapRuntime}。这个静态门面只用于迁移期间保持 Player 与
 * GameRoom 的既有调用不变，内部数据已经全部来自归一化后的 Map Contract V2 运行时。
 */
@Deprecated(forRemoval = false)
public final class WorldMap {
  private static final MapRuntime RUNTIME = new MapRuntime(
      new MapLoader(new ObjectMapper()).loadClasspath("/static/maps/arena.json"));
  private static final List<Item> ITEMS = RUNTIME.items().stream()
      .map(item -> new Item(item.id(), item.weaponId(), item.x(), item.z()))
      .toList();

  private WorldMap() {}

  public static boolean collides(double x, double y, double z) {
    return RUNTIME.collides(x, y, z);
  }

  public static double firstObstacleDistance(
      double ox, double oy, double oz, double dx, double dy, double dz, double maxDistance) {
    return RUNTIME.firstObstacleDistance(ox, oy, oz, dx, dy, dz, maxDistance);
  }

  public static double[] randomSpawn() {
    return RUNTIME.randomSpawn();
  }

  public static List<Item> items() {
    return ITEMS;
  }

  public record Item(String id, String weapon, double x, double z) {}
}
