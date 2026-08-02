package com.neon.arena.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.transport.SpringGameConnection;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Spring WebSocket 网络适配器。
 *
 * I/O 线程只完成协议解析并投递 GameCommand，不直接修改游戏世界。
 * Spring 和 Netty 可以因此同时连接同一个 GameRoom。
 */
@Component
public class GameServer extends TextWebSocketHandler {
  private final ObjectMapper json;
  private final RoomManager roomManager;
  private final Map<String,GameRoom> sessionRooms=new ConcurrentHashMap<>();
  private final Set<String> admittedSessions=ConcurrentHashMap.newKeySet();
  private final Map<String,MessageWindow> messageWindows=new ConcurrentHashMap<>();
  private static final class MessageWindow {long startedAt=System.currentTimeMillis();int count;}

  public GameServer(ObjectMapper json,RoomManager roomManager){this.json=json;this.roomManager=roomManager;}

  @Override public void afterConnectionEstablished(WebSocketSession session)throws Exception{
    if(!roomManager.tryAcquireConnection()){session.close(CloseStatus.SERVICE_OVERLOAD);return;}
    admittedSessions.add(session.getId());
    String requested=roomManager.defaultRoomId();
    if(session.getUri()!=null){String value=UriComponentsBuilder.fromUri(session.getUri()).build().getQueryParams().getFirst("room");if(value!=null&&!value.isBlank())requested=value;}
    GameRoom room=roomManager.find(requested).orElse(null);
    if(room==null){release(session.getId());session.close(CloseStatus.POLICY_VIOLATION);return;}
    sessionRooms.put(session.getId(),room);
    room.submit(new GameCommand.Connect(new SpringGameConnection(session)));
  }

  @Override protected void handleTextMessage(WebSocketSession session,TextMessage message){
    try{
      if(message.getPayloadLength()>16*1024||!allowMessage(session.getId())){session.close(CloseStatus.POLICY_VIOLATION);return;}
      JsonNode payload=json.readTree(message.getPayload());
      // Keep fallback WebSocket latency semantics identical to the Netty path.
      if("ping".equals(payload.path("type").asText())){
        session.sendMessage(new TextMessage(json.createObjectNode().put("type","pong")
            .put("clientTime",payload.path("clientTime").asLong()).toString()));
        return;
      }
      GameRoom room=sessionRooms.get(session.getId());if(room!=null)room.submit(new GameCommand.Message("spring:"+session.getId(),payload));
    }catch(Exception ignored){}
  }

  @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status){
    GameRoom room=sessionRooms.remove(session.getId());if(room!=null)room.submit(new GameCommand.Disconnect("spring:"+session.getId()));
    release(session.getId());
  }

  @Override public void handleTransportError(WebSocketSession session,Throwable error)throws Exception{session.close();}

  private boolean allowMessage(String id){
    long now=System.currentTimeMillis();MessageWindow window=messageWindows.computeIfAbsent(id,key->new MessageWindow());
    synchronized(window){if(now-window.startedAt>=1_000){window.startedAt=now;window.count=0;}return ++window.count<=80;}
  }
  private void release(String id){messageWindows.remove(id);if(admittedSessions.remove(id))roomManager.releaseConnection();}
}
