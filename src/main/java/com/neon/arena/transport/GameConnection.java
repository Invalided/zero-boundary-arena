package com.neon.arena.transport;

/**
 * 游戏房间看到的唯一网络抽象。
 *
 * 房间只关心连接标识、存活状态和文本发送能力，不关心底层使用的是
 * Spring WebSocketSession、Netty Channel，还是将来的测试连接。
 */
public interface GameConnection {
  String id();
  boolean isOpen();
  void send(String text);
  void close();
}
