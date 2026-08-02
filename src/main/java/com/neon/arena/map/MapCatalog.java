package com.neon.arena.map;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 官方地图白名单。房间只引用稳定 roomId，不接受客户端传入文件路径。
 *
 * <p>MVP 先注册两张官方地图；以后数据库中的自定义房间仍只保存 mapId，地图资源的加载、
 * 校验和版本摘要继续由这里统一提供。</p>
 */
@Component
public class MapCatalog {
  public record Entry(
      String roomId, String displayName, String description, String resourcePath, String posterUrl,
      byte[] sourceBytes, MapDefinition definition) {
    @Override public byte[] sourceBytes() { return sourceBytes.clone(); }
  }

  private final Map<String, Entry> entries;

  public MapCatalog(MapLoader loader) {
    Map<String, Entry> values = new LinkedHashMap<>();
    register(values, loader, "arena-night", "夜幕竞技场", "经典夜间自由混战",
        "/static/maps/arena.json", "/assets/loading/arena-night.webp");
    register(values, loader, "polygon-arena", "能源中转站", "中央能源核心与双侧设备区自由混战",
        "/static/maps/polygon-arena.json", "/assets/loading/polygon-arena.webp");
    // 登录页沿用注册顺序展示官方地图；Map.copyOf 不保证保留 LinkedHashMap 的迭代顺序。
    entries = Collections.unmodifiableMap(new LinkedHashMap<>(values));
  }

  public Entry require(String roomId) {
    Entry entry = entries.get(roomId);
    if (entry == null) throw new IllegalArgumentException("Unknown official room: " + roomId);
    return entry;
  }

  public List<Entry> entries() { return List.copyOf(entries.values()); }

  private static void register(
      Map<String, Entry> target, MapLoader loader, String roomId, String displayName,
      String description, String resourcePath, String posterUrl) {
    byte[] bytes = loader.readClasspathBytes(resourcePath);
    MapDefinition definition = loader.load(bytes);
    target.put(roomId,
        new Entry(roomId, displayName, description, resourcePath, posterUrl, bytes, definition));
  }
}
