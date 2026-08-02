package com.neon.arena.game;

import com.neon.arena.weapon.WeaponDefinition;
import org.springframework.stereotype.Component;

/**
 * 服务端唯一的生命/护甲伤害结算入口。当前保持旧规则：单发伤害的一半（向下取整）
 * 先扣护甲，剩余伤害扣生命。以后加入 armorPenetration、部位系数或护甲材质时，
 * 统一扩展这里，GameRoom 和开发平衡报告都会自动使用同一套公式。
 */
@Component
public final class DamageResolver {
  public record Result(int rawDamage,int armorDamage,int healthDamage,int remainingArmor,int remainingHealth) {
    public boolean killed(){return remainingHealth<=0;}
    public int dealtDamage(){return armorDamage+healthDamage;}
  }

  public Result resolve(WeaponDefinition weapon,double distance,boolean headshot,int health,int armor){
    return resolveRaw(weapon.damage(distance,headshot),health,armor,weapon.armorPenetration());
  }

  /** Shared armor/health settlement for explosions and future environmental damage. */
  public Result resolveRaw(int raw,int health,int armor){
    return resolveRaw(raw,health,armor,0);
  }

  /**
   * armorPenetration 表示绕过基础护甲减伤的比例：0 保持旧版 50% 吸收规则，1 完全无视护甲。
   * 该值属于基础枪械定义，皮肤和商品外观不得在竞技规则中覆盖它。
   */
  Result resolveRaw(int raw,int health,int armor,double armorPenetration){
    raw=Math.max(1,raw);
    double penetration=Math.max(0,Math.min(1,armorPenetration));
    int absorbed=Math.min(Math.max(0,armor),(int)Math.floor(raw*.5*(1-penetration)));
    int healthDamage=Math.min(Math.max(0,health),raw-absorbed);
    return new Result(raw,absorbed,healthDamage,Math.max(0,armor-absorbed),Math.max(0,health-healthDamage));
  }

  public int shotsToKill(WeaponDefinition weapon,double distance,boolean headshot,int health,int armor){
    int shots=0;
    while(health>0&&shots<100){
      Result result=resolve(weapon,distance,headshot,health,armor);
      health=result.remainingHealth();armor=result.remainingArmor();shots++;
    }
    return shots;
  }

  public long timeToKillMs(WeaponDefinition weapon,int shots){
    if(shots<=1)return 0;
    long interval=Math.max(weapon.fireIntervalMs(),weapon.cycleTimeMs());
    return (shots-1)*interval;
  }
}
