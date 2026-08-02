package com.neon.arena.game;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Lightweight cached-by-the-browser-never public occupancy view; no player identity is exposed. */
@RestController
@RequestMapping("/api/status")
public class PublicStatusController {
  private final RoomManager rooms;

  public PublicStatusController(RoomManager rooms){this.rooms=rooms;}

  @GetMapping
  public ResponseEntity<Map<String,Object>> status(){
    List<Map<String,Object>> roomList=rooms.rooms().entrySet().stream().map(entry->{
      GameRoom.RoomStatus status=entry.getValue().roomStatus();
      Map<String,Object> value=new LinkedHashMap<>();
      value.put("roomId",entry.getKey());value.put("players",status.players());value.put("spectators",status.spectators());
      value.put("bots",status.bots());value.put("capacity",status.capacity());value.put("full",status.players()>=status.capacity());
      value.put("phase",status.phase());value.put("tickMs",Math.round(status.tickMicros()/100.0)/10.0);value.put("queueDepth",status.queueDepth());
      value.put("maxTickMs",Math.round(status.maxTickMicros()/100.0)/10.0);value.put("tickOverruns",status.tickOverruns());
      value.put("outboundKiBps",status.outboundKiBps());value.put("snapshotChars",status.snapshotChars());
      return value;
    }).toList();
    int players=roomList.stream().mapToInt(value->(Integer)value.get("players")).sum();
    int spectators=roomList.stream().mapToInt(value->(Integer)value.get("spectators")).sum();
    Map<String,Object> response=new LinkedHashMap<>();response.put("online",rooms.activeConnections());
    response.put("inBattle",players);response.put("spectators",spectators);response.put("roomCount",roomList.size());
    response.put("connectionCapacity",rooms.maxConnections());response.put("rooms",roomList);response.put("updatedAt",System.currentTimeMillis());
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(response);
  }
}
