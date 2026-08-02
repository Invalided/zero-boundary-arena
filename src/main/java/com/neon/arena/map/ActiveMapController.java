package com.neon.arena.map;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/** 向客户端发布服务端本次启动实际加载的地图，不接受浏览器传入任意资源路径。 */
@RestController
@RequestMapping("/api/maps")
public class ActiveMapController {
  private final ActiveMap activeMap;
  private final MapCatalog catalog;

  public ActiveMapController(ActiveMap activeMap, MapCatalog catalog) {
    this.activeMap = activeMap;
    this.catalog = catalog;
  }

  @GetMapping
  public Map<String, Object> catalog() {
    return Map.of("defaultRoomId", "polygon-arena", "maps", catalog.entries().stream()
        .map(entry -> Map.of(
            "roomId", entry.roomId(), "mapId", entry.definition().id(),
            "displayName", entry.displayName(), "description", entry.description(),
            "revision", entry.definition().revision(), "theme", entry.definition().environment().theme(),
            "posterUrl", entry.posterUrl()))
        .toList());
  }

  @GetMapping(value = "/active", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<byte[]> active() {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noCache())
        .contentType(MediaType.APPLICATION_JSON)
        .body(activeMap.sourceBytes());
  }


  @GetMapping(value = "/{roomId}", produces = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<byte[]> byRoom(@PathVariable String roomId) {
    try {
      return ResponseEntity.ok().cacheControl(CacheControl.noCache())
          .contentType(MediaType.APPLICATION_JSON).body(catalog.require(roomId).sourceBytes());
    } catch (IllegalArgumentException error) {
      return ResponseEntity.notFound().build();
    }
  }
}
