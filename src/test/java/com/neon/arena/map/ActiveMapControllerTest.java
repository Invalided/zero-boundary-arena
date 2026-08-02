package com.neon.arena.map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ActiveMapControllerTest {
  @Test
  void endpointReturnsTheExactBytesUsedByRuntimeDefinition() {
    MapLoader loader = new MapLoader(new ObjectMapper());
    ActiveMap activeMap = new ActiveMap(loader, "/static/maps/polygon-arena.json");
    ActiveMapController controller = new ActiveMapController(activeMap, new MapCatalog(loader));

    assertEquals("zero-polygon-arena", activeMap.definition().id());
    assertArrayEquals(loader.readClasspathBytes("/static/maps/polygon-arena.json"),
        controller.active().getBody());
    java.util.List<?> maps=(java.util.List<?>) controller.catalog().get("maps");
    assertEquals(2, maps.size());
    assertEquals("/assets/loading/arena-night.webp",
        ((java.util.Map<?, ?>) maps.get(0)).get("posterUrl"));
    assertArrayEquals(loader.readClasspathBytes("/static/maps/arena.json"),
        controller.byRoom("arena-night").getBody());
  }
}
