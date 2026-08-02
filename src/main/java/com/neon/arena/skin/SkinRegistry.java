package com.neon.arena.skin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.neon.arena.weapon.WeaponDefinition;
import com.neon.arena.weapon.WeaponRegistry;
import org.springframework.beans.factory.config.YamlMapFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * 启动时加载皮肤白名单。运行时只查询这份不可变目录，客户端无法临时构造材质或枪口参数。
 */
@Component
public class SkinRegistry {
  private final Map<String,SkinDefinition> definitions;

  public SkinRegistry(WeaponRegistry weapons){this.definitions=Collections.unmodifiableMap(load(weapons));}

  public Optional<SkinDefinition> find(String skinId){return Optional.ofNullable(definitions.get(skinId));}
  public boolean compatible(SkinDefinition skin,WeaponDefinition weapon){
    return skin.weaponIds().contains(weapon.id())||skin.familyCodes().contains(weapon.familyCode());
  }
  public Set<String> defaultOwnedSkinIds(){
    LinkedHashSet<String> result=new LinkedHashSet<>();
    definitions.values().stream().filter(SkinDefinition::grantedByDefault).forEach(s->result.add(s.skinId()));
    return Collections.unmodifiableSet(result);
  }
  public Optional<String> defaultSkinId(WeaponDefinition weapon){
    return definitions.values().stream().filter(SkinDefinition::defaultForCompatibleWeapon).filter(s->compatible(s,weapon)).map(SkinDefinition::skinId).findFirst();
  }

  /** 客户端只获得已审核资源的标识与展示信息，不下发可由客户端回传并信任的任意特效参数。 */
  public ArrayNode clientCatalog(ObjectMapper json){
    ArrayNode result=json.createArrayNode();
    definitions.values().forEach(s->{
      ObjectNode node=json.createObjectNode().put("skinId",s.skinId()).put("code",s.code()).put("name",s.displayName())
          .put("materialVariant",s.materialVariant()).put("muzzleProfile",s.muzzleProfile());
      ArrayNode weapons=node.putArray("weaponIds");s.weaponIds().forEach(weapons::add);
      ArrayNode families=node.putArray("familyCodes");s.familyCodes().forEach(families::add);
      result.add(node);
    });
    return result;
  }

  @SuppressWarnings("unchecked")
  private Map<String,SkinDefinition> load(WeaponRegistry weapons){
    YamlMapFactoryBean yaml=new YamlMapFactoryBean();yaml.setResources(new ClassPathResource("skins.yml"));
    Map<String,Object> root=Objects.requireNonNull(yaml.getObject(),"skins.yml is empty");
    Map<String,Object> source=(Map<String,Object>)root.get("skins");
    if(source==null||source.isEmpty())throw new IllegalStateException("No skins configured");
    LinkedHashMap<String,SkinDefinition> result=new LinkedHashMap<>();
    source.forEach((skinId,value)->{
      Map<String,Object> fields=(Map<String,Object>)value;
      SkinDefinition skin=new SkinDefinition(skinId,text(fields,"code"),text(fields,"displayName"),
          stringSet(fields.get("weaponIds")),stringSet(fields.get("familyCodes")),text(fields,"materialVariant"),
          text(fields,"muzzleProfile"),bool(fields,"grantedByDefault"),bool(fields,"defaultForCompatibleWeapon"));
      validate(skin,weapons);
      result.put(skinId,skin);
    });
    if(result.values().stream().map(SkinDefinition::code).distinct().count()!=result.size())throw new IllegalStateException("Skin codes must be unique");
    return result;
  }

  private void validate(SkinDefinition skin,WeaponRegistry weapons){
    try{UUID.fromString(skin.skinId());}catch(IllegalArgumentException error){throw new IllegalStateException("Invalid skin UUID: "+skin.skinId(),error);}
    if(skin.code().isBlank()||skin.displayName().isBlank())throw new IllegalStateException("Skin identity cannot be blank: "+skin.skinId());
    if(skin.weaponIds().isEmpty()&&skin.familyCodes().isEmpty())throw new IllegalStateException("Skin has no compatible weapon: "+skin.skinId());
    skin.weaponIds().forEach(id->{if(!weapons.contains(id))throw new IllegalStateException("Skin references unknown weapon: "+id);});
  }
  private String text(Map<String,Object> map,String key){return Objects.toString(Objects.requireNonNull(map.get(key),"Missing skin field: "+key));}
  private boolean bool(Map<String,Object> map,String key){return Boolean.parseBoolean(text(map,key));}
  private Set<String> stringSet(Object value){
    if(value==null)return Set.of();
    if(!(value instanceof Collection<?> values))throw new IllegalStateException("Skin compatibility field must be a list");
    LinkedHashSet<String> result=new LinkedHashSet<>();values.forEach(v->result.add(Objects.toString(v)));
    return Collections.unmodifiableSet(result);
  }
}
