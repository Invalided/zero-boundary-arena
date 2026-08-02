package com.neon.arena.weapon;

import com.neon.arena.game.DamageResolver;
import org.springframework.stereotype.Component;

import java.util.List;

/** 本地开发工具使用的 TTK 矩阵；不参与战斗 Tick，也不向玩家端下发。 */
@Component
public final class WeaponBalanceAnalyzer {
  public record Cell(String weaponId,String displayName,double distance,boolean headshot,int rawDamage,
                     int shotsToKill,long timeToKillMs) {}

  private final WeaponRegistry registry;
  private final DamageResolver damageResolver;

  public WeaponBalanceAnalyzer(WeaponRegistry registry,DamageResolver damageResolver){
    this.registry=registry;this.damageResolver=damageResolver;
  }

  /**
   * 固定报告距离让不同版本可以直接比较。距离超过枪械 maxRange 也保留一格，
   * 便于观察最小伤害和“远距离仍可造成伤害”的边界；正式游戏仍由 maxRange 射线限制。
   */
  public List<Cell> report(){
    List<Double> distances=List.of(0d,25d,50d,75d,100d);
    return registry.values().stream().flatMap(weapon->distances.stream().flatMap(distance->List.of(false,true).stream().map(headshot->{
      int raw=weapon.damage(distance,headshot);int shots=damageResolver.shotsToKill(weapon,distance,headshot,100,50);
      return new Cell(weapon.id(),weapon.displayName(),distance,headshot,raw,shots,damageResolver.timeToKillMs(weapon,shots));
    }))).toList();
  }
}
