package com.neon.arena.weapon;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.config.YamlMapFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * 启动时加载并校验 weapons.yml。解析完成后使用不可变 Map 发布，
 * 战斗 Tick 中只做 O(1) 查询，不在射击时重复读取 YAML。
 */
@Component
public class WeaponRegistry {
  private final Map<String,WeaponDefinition> definitions;

  public WeaponRegistry(){this.definitions=Collections.unmodifiableMap(load());}
  public WeaponDefinition require(String id){WeaponDefinition value=definitions.get(id);if(value==null)throw new IllegalArgumentException("Unknown weapon: "+id);return value;}
  public boolean contains(String id){return definitions.containsKey(id);}
  public Collection<WeaponDefinition> values(){return definitions.values();}

  @SuppressWarnings("unchecked")
  private Map<String,WeaponDefinition> load(){
    YamlMapFactoryBean yaml=new YamlMapFactoryBean();yaml.setResources(new ClassPathResource("weapons.yml"));
    Map<String,Object> root=Objects.requireNonNull(yaml.getObject(),"weapons.yml is empty");
    Map<String,Object> source=(Map<String,Object>)root.get("weapons");
    if(source==null||source.isEmpty())throw new IllegalStateException("No weapons configured");
    Map<String,WeaponDefinition> result=new LinkedHashMap<>();
    source.forEach((id,value)->{WeaponDefinition definition=parse(id,(Map<String,Object>)value);validate(definition);result.put(id,definition);});
    if(result.values().stream().map(WeaponDefinition::uuid).distinct().count()!=result.size())throw new IllegalStateException("Weapon UUIDs must be unique");
    if(result.values().stream().map(WeaponDefinition::code).distinct().count()!=result.size())throw new IllegalStateException("Weapon codes must be unique");
    return result;
  }

  private WeaponDefinition parse(String id,Map<String,Object> value){return new WeaponDefinition(
      id,text(value,"uuid"),text(value,"code"),text(value,"familyCode"),text(value,"displayName"),WeaponCategory.valueOf(text(value,"category")),WeaponSlot.valueOf(text(value,"slot")),
      WeaponFireMode.valueOf(text(value,"fireMode")),WeaponReloadType.valueOf(text(value,"reloadType")),text(value,"ammoType"),
      integer(value,"magazineSize"),integer(value,"reserveAmmo"),integer(value,"baseDamage"),number(value,"headMultiplier"),number(value,"armorPenetration"),number(value,"movementMultiplier"),
      integer(value,"fireIntervalMs"),integer(value,"cycleTimeMs"),booleanValue(value,"retainScopeAfterShot"),integer(value,"aimInMs"),integer(value,"equipMs"),integer(value,"reloadMs"),integer(value,"reloadCommitMs"),number(value,"maxRange"),
      number(value,"hipSpread"),number(value,"aimedSpread"),number(value,"recoilKick"),number(value,"bloomPerShot"),number(value,"maxBloom"),
      number(value,"verticalRecoil"),number(value,"horizontalRecoil"),number(value,"pitchRecovery"),number(value,"yawRecovery"),number(value,"heatRecovery"),number(value,"viewKickScale"),
      number(value,"falloffStart"),number(value,"falloffEnd"),number(value,"minimumDamageMultiplier"));}
  private void validate(WeaponDefinition w){
    try{UUID.fromString(w.uuid());}catch(IllegalArgumentException error){throw new IllegalStateException(w.id()+" has invalid UUID",error);}
    if(w.code().isBlank()||w.familyCode().isBlank())throw new IllegalStateException(w.id()+" has missing stable identity code");
    if(w.magazineSize()<=0||w.baseDamage()<=0||w.fireIntervalMs()<=0||w.reloadMs()<=0)throw new IllegalStateException(w.id()+" contains non-positive combat values");
    if(w.reserveAmmo()<-1)throw new IllegalStateException(w.id()+" reserveAmmo must be -1 or non-negative");
    if(w.reloadCommitMs()<0||w.reloadCommitMs()>w.reloadMs())throw new IllegalStateException(w.id()+" has invalid reload commit time");
    if(w.falloffStart()<0||w.falloffEnd()<=w.falloffStart())throw new IllegalStateException(w.id()+" has invalid falloff range");
    if(w.minimumDamageMultiplier()<=0||w.minimumDamageMultiplier()>1)throw new IllegalStateException(w.id()+" has invalid minimum multiplier");
    if(w.armorPenetration()<0||w.armorPenetration()>1)throw new IllegalStateException(w.id()+" has invalid armor penetration");
    if(w.movementMultiplier()<.5||w.movementMultiplier()>1.25)throw new IllegalStateException(w.id()+" has invalid movement multiplier");
  }
  private String text(Map<String,Object> map,String key){return Objects.toString(required(map,key));}
  private int integer(Map<String,Object> map,String key){return ((Number)required(map,key)).intValue();}
  private double number(Map<String,Object> map,String key){return ((Number)required(map,key)).doubleValue();}
  private boolean booleanValue(Map<String,Object> map,String key){return Boolean.parseBoolean(Objects.toString(required(map,key)));}
  private Object required(Map<String,Object> map,String key){return Objects.requireNonNull(map.get(key),"Missing weapon field: "+key);}

  /** 下发客户端表现所需参数；最终伤害仍只由服务端计算。 */
  public ArrayNode clientCatalog(ObjectMapper json){ArrayNode list=json.createArrayNode();definitions.values().forEach(w->{ObjectNode n=json.createObjectNode()
      .put("id",w.id()).put("uuid",w.uuid()).put("code",w.code()).put("familyCode",w.familyCode()).put("name",w.displayName()).put("category",w.category().name()).put("slot",w.slot().name()).put("fireMode",w.fireMode().name()).put("reloadType",w.reloadType().name()).put("ammoType",w.ammoType())
      .put("mag",w.magazineSize()).put("defaultReserve",w.reserveAmmo()).put("armorPenetration",w.armorPenetration()).put("movementMultiplier",w.movementMultiplier()).put("spread",w.hipSpread()).put("aimedSpread",w.aimedSpread()).put("kick",w.recoilKick())
      .put("bloomPerShot",w.bloomPerShot()).put("maxBloom",w.maxBloom()).put("verticalRecoil",w.verticalRecoil()).put("horizontalRecoil",w.horizontalRecoil())
      .put("pitchRecovery",w.pitchRecovery()).put("yawRecovery",w.yawRecovery()).put("heatRecovery",w.heatRecovery()).put("viewKickScale",w.viewKickScale())
      .put("cooldown",Math.max(w.fireIntervalMs(),w.cycleTimeMs())).put("cycle",w.cycleTimeMs()).put("retainScopeAfterShot",w.retainScopeAfterShot()).put("aimIn",w.aimInMs()).put("equip",w.equipMs()).put("reload",w.reloadMs()).put("reloadCommit",w.reloadCommitMs());list.add(n);});return list;}
}
