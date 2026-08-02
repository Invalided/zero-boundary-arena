package com.neon.arena.config;

import com.neon.arena.game.GameServer;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final GameServer gameServer;

    public WebSocketConfig(GameServer gameServer) {
        this.gameServer = gameServer;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(gameServer, "/ws/game").setAllowedOriginPatterns("*");
    }
}
