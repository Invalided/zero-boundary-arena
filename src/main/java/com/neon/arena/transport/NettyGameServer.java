package com.neon.arena.transport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.game.GameCommand;
import com.neon.arena.game.GameRoom;
import com.neon.arena.game.RoomManager;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.*;
import io.netty.handler.codec.http.QueryStringDecoder;
import io.netty.handler.timeout.IdleStateEvent;
import io.netty.handler.timeout.IdleStateHandler;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 独立的 Netty WebSocket 游戏网关。
 *
 * bossGroup 只接受新连接，workerGroup 的 EventLoop 负责握手、读取和写入。
 * Handler 不执行游戏逻辑，只把 JSON 转成 GameCommand 投递给 GameRoom。
 */
@Component
public class NettyGameServer {
  private final ObjectMapper json;
  private final RoomManager roomManager;
  private final boolean enabled;
  private final String host;
  private final int port;
  private EventLoopGroup bossGroup;
  private EventLoopGroup workerGroup;
  private Channel serverChannel;

  public NettyGameServer(ObjectMapper json,RoomManager roomManager,
      @Value("${game.netty.enabled:true}") boolean enabled,
      @Value("${game.netty.host:0.0.0.0}") String host,
      @Value("${game.netty.port:8081}") int port){this.json=json;this.roomManager=roomManager;this.enabled=enabled;this.host=host;this.port=port;}

  @PostConstruct
  void start(){
    if(!enabled)return;
    bossGroup=new NioEventLoopGroup(1);
    workerGroup=new NioEventLoopGroup();
    ServerBootstrap bootstrap=new ServerBootstrap();
    bootstrap.group(bossGroup,workerGroup).channel(NioServerSocketChannel.class)
        .childOption(ChannelOption.TCP_NODELAY,true)
        .childOption(ChannelOption.WRITE_BUFFER_WATER_MARK,new WriteBufferWaterMark(32*1024,128*1024))
        .childHandler(new ChannelInitializer<SocketChannel>(){
          @Override protected void initChannel(SocketChannel channel){
            ChannelPipeline pipeline=channel.pipeline();
            pipeline.addLast("httpCodec",new HttpServerCodec());
            pipeline.addLast("httpAggregator",new HttpObjectAggregator(64*1024));
            pipeline.addLast("readIdle",new IdleStateHandler(45,0,0));
            WebSocketServerProtocolConfig websocketConfig=WebSocketServerProtocolConfig.newBuilder()
                .websocketPath("/ws/game").checkStartsWith(true).allowExtensions(true)
                .maxFramePayloadLength(16*1024).build();
            pipeline.addLast("websocket",new WebSocketServerProtocolHandler(websocketConfig));
            pipeline.addLast("game",new GameFrameHandler(json,roomManager));
          }
        });
    serverChannel=bootstrap.bind(host,port).syncUninterruptibly().channel();
  }

  @PreDestroy
  void stop(){
    if(serverChannel!=null)serverChannel.close().syncUninterruptibly();
    if(workerGroup!=null)workerGroup.shutdownGracefully().syncUninterruptibly();
    if(bossGroup!=null)bossGroup.shutdownGracefully().syncUninterruptibly();
  }

  /** 每个连接拥有独立 Handler 实例，用 registered 标记是否完成 WebSocket 握手。 */
  private static final class GameFrameHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {
    private final ObjectMapper json;
    private final RoomManager roomManager;
    private GameRoom room;
    private boolean registered;
    private boolean admitted;
    private String connectionId;
    private long messageWindowStartedAt=System.currentTimeMillis();
    private int messageCount;
    private GameFrameHandler(ObjectMapper json,RoomManager roomManager){this.json=json;this.roomManager=roomManager;}

    @Override public void userEventTriggered(ChannelHandlerContext ctx,Object event)throws Exception{
      if(event instanceof WebSocketServerProtocolHandler.HandshakeComplete complete){
        if(!roomManager.tryAcquireConnection()){ctx.close();return;}
        admitted=true;
        QueryStringDecoder decoder = new QueryStringDecoder(complete.requestUri());
        String requestedRoom = decoder.parameters().getOrDefault("room", java.util.List.of(roomManager.defaultRoomId())).get(0);
        room=roomManager.find(requestedRoom).orElse(null);
        if(room==null){roomManager.releaseConnection();admitted=false;ctx.close();return;}
        NettyGameConnection connection=new NettyGameConnection(ctx.channel());
        registered=true;connectionId=connection.id();
        room.submit(new GameCommand.Connect(connection));
      }else if(event instanceof IdleStateEvent){
        ctx.close();
      }else super.userEventTriggered(ctx,event);
    }

    @Override protected void channelRead0(ChannelHandlerContext ctx,TextWebSocketFrame frame){
      if(!registered)return;
      long now=System.currentTimeMillis();if(now-messageWindowStartedAt>=1_000){messageWindowStartedAt=now;messageCount=0;}
      if(++messageCount>80){ctx.close();return;}
      try{
        JsonNode payload=json.readTree(frame.text());
        // Transport RTT must not include up to one 20 Hz simulation-tick wait.
        // Ping has no world-state side effects, so answer it on the Netty event loop.
        if("ping".equals(payload.path("type").asText())){
          String pong=json.createObjectNode().put("type","pong")
              .put("clientTime",payload.path("clientTime").asLong()).toString();
          ctx.writeAndFlush(new TextWebSocketFrame(pong));
          return;
        }
        room.submit(new GameCommand.Message(connectionId,payload));
      }
      catch(Exception ignored){}
    }

    @Override public void channelInactive(ChannelHandlerContext ctx)throws Exception{
      if(registered)room.submit(new GameCommand.Disconnect(connectionId));
      if(admitted){admitted=false;roomManager.releaseConnection();}
      super.channelInactive(ctx);
    }

    @Override public void exceptionCaught(ChannelHandlerContext ctx,Throwable error){ctx.close();}
  }
}
