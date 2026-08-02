package com.neon.arena.transport;

import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

/** Netty Channel 到 GameConnection 的适配器。 */
public final class NettyGameConnection implements GameConnection {
  private final Channel channel;
  public NettyGameConnection(Channel channel){this.channel=channel;}
  @Override public String id(){return "netty:"+channel.id().asLongText();}
  @Override public boolean isOpen(){return channel.isActive();}

  /**
   * Channel.writeAndFlush 可以从房间线程调用，Netty 会把真正的写操作调度回
   * 该 Channel 所属的 EventLoop。不可写表示积压过多，此时关闭慢连接以保护内存。
   */
  @Override public void send(String text){
    if(!channel.isActive())return;
    if(!channel.isWritable()){channel.close();return;}
    channel.writeAndFlush(new TextWebSocketFrame(text));
  }
  @Override public void close(){channel.close();}
}
