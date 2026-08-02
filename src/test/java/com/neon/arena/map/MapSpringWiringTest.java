package com.neon.arena.map;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.game.MatchController;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class MapSpringWiringTest {
  /** 单元测试直接 new 对象无法发现构造器歧义，因此单独覆盖一次真实 Spring 装配。 */
  @Test
  void mapRuntimeCanBeCreatedBySpring() {
    try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
      context.registerBean(ObjectMapper.class);
      context.register(MapLoader.class, ActiveMap.class, MapRuntime.class, MatchController.class);
      context.refresh();

      // 这个轻量容器不加载 application.yml，因此验证 @Value 的 arena 默认回退值。
      assertEquals("neon-arena", context.getBean(MapRuntime.class).id());
      assertEquals(MatchController.Phase.WAITING,context.getBean(MatchController.class).phase());
    }
  }
}
