package com.neon.arena.game;

import com.neon.arena.weapon.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PlayerInputQueueTest {
  private final WeaponDefinition m4=new WeaponDefinition("m4a1","00000000-0000-0000-0000-000000000001","m4a1.standard","m4a1","M4A1",WeaponCategory.ASSAULT_RIFLE,
      WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"5.56",30,-1,28,1.65,0,90,0,false,120,350,2100,1650,90,
      .018,.006,7,.14,1.3,.006,.0018,7.2,9,2.15,.8,24,72,.72);
  private static PlayerInput in(long seq){return new PlayerInput(seq,1,0,false,0,0,false);}

  @Test void twoInputsInOneTickAreBothSimulatedInOrder(){
    Player p=new Player("p1",m4);
    p.enqueueInput(in(1));p.enqueueInput(in(2));
    p.inputCredit=1; // 上一 Tick 没收到输入，留下一点额度
    List<PlayerInput> batch=p.takeInputsForTick();
    assertEquals(List.of(1L,2L),batch.stream().map(PlayerInput::sequence).toList());
  }
  @Test void emptyTickSimulatesNothingInsteadOfRepeatingLastInput(){
    Player p=new Player("p1",m4);
    p.enqueueInput(in(1));
    assertEquals(1,p.takeInputsForTick().size());
    assertTrue(p.takeInputsForTick().isEmpty());
  }
  @Test void rejectsReplayedAndOutOfOrderInputs(){
    Player p=new Player("p1",m4);
    assertTrue(p.enqueueInput(in(5)));
    assertFalse(p.enqueueInput(in(5)));
    assertFalse(p.enqueueInput(in(3)));
    assertEquals(1,p.inputQueue.size());
  }
  @Test void floodingInputsCannotOutrunTickRate(){
    Player p=new Player("p1",m4);
    int simulated=0;
    for(int tick=0;tick<100;tick++){
      for(int k=0;k<4;k++)p.enqueueInput(in(tick*4L+k+1)); // 4 倍速率狂发
      simulated+=p.takeInputsForTick().size();
    }
    assertTrue(simulated<=100+Player.MAX_INPUT_CREDIT,"simulated="+simulated);
    assertTrue(p.inputQueue.size()<=Player.MAX_QUEUED_INPUTS);
  }
  @Test void jitterBurstIsCaughtUpWithinCreditLimit(){
    Player p=new Player("p1",m4);
    assertTrue(p.takeInputsForTick().isEmpty());
    assertTrue(p.takeInputsForTick().isEmpty());
    p.enqueueInput(in(1));p.enqueueInput(in(2));p.enqueueInput(in(3));
    assertEquals(3,p.takeInputsForTick().size());
  }
  @Test void respawnClearsQueuedInputs(){
    Player p=new Player("p1",m4);
    p.enqueueInput(in(1));p.enqueueInput(in(2));
    p.respawn(new double[]{0,0,0});
    assertTrue(p.inputQueue.isEmpty());
    assertTrue(p.enqueueInput(in(3)));
    assertFalse(p.enqueueInput(in(2)));
  }
}
