package com.neon.arena.map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 当前房间唯一的活动地图快照。
 *
 * <p>启动时只读取一次资源，并同时保存原始字节和解析后的运行时定义。客户端地图接口与服务端
 * 碰撞系统从同一个快照取数据，从结构上杜绝两端地图版本不一致。
 */
@Component
public class ActiveMap {
  private final String resourcePath;
  private final byte[] sourceBytes;
  private final MapDefinition definition;

  public ActiveMap(
      MapLoader loader,
      @Value("${game.map-resource:/static/maps/arena.json}") String resourcePath) {
    this.resourcePath = normalize(resourcePath);
    this.sourceBytes = loader.readClasspathBytes(this.resourcePath);
    this.definition = loader.load(sourceBytes);
  }

  public String resourcePath() { return resourcePath; }
  public byte[] sourceBytes() { return sourceBytes.clone(); }
  public MapDefinition definition() { return definition; }

  private static String normalize(String path) {
    if (path == null || path.isBlank()) return "/static/maps/arena.json";
    return path.startsWith("/") ? path : "/" + path;
  }
}
