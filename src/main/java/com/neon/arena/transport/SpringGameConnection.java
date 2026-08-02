package com.neon.arena.transport;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/** Spring WebSocket 的适配器，保留它作为 Netty 迁移期间的回退入口。 */
public final class SpringGameConnection implements GameConnection {
  private final WebSocketSession session;
  public SpringGameConnection(WebSocketSession session){this.session=session;}
  @Override public String id(){return "spring:"+session.getId();}
  @Override public boolean isOpen(){return session.isOpen();}
  @Override public void send(String text){
    if(!session.isOpen())return;
    synchronized(session){try{if(session.isOpen())session.sendMessage(new TextMessage(text));}catch(Exception ignored){}}
  }
  @Override public void close(){try{session.close();}catch(Exception ignored){}}
}
