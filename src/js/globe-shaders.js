/**
 * WebGL 着色器源码。与 DOM 交互分离，便于独立阅读投影和颜色采样。
 * world 的红/绿/蓝通道分别承载地形、边界与经纬网；regions 编码国家整数 key。
 */
window.ClockGlobeShaders = {
  vertex: `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `,
  fragment: `
        precision highp float;
        uniform vec2 center;
        uniform float radius;
        uniform vec4 rotation;
        uniform sampler2D world;
        uniform sampler2D regions;
        uniform vec2 countryKeys;
        const float PI=3.141592653589793;
        void main(){
          vec2 p=(gl_FragCoord.xy-center)/radius;
          float distance=length(p);
          float aa=1.2/radius;
          if(distance>1.0+aa){
            float halo=0.17*exp(-32.0*(distance-1.0));
            gl_FragColor=vec4(vec3(0.16,0.67,0.81)*halo,halo);
            return;
          }
          vec2 surface=p/max(1.0,distance);
          float z=sqrt(max(0.0,1.0-dot(surface,surface)));
          float latitude=asin(clamp(surface.y*rotation.w+z*rotation.z,-1.0,1.0));
          float delta=atan(surface.x,z*rotation.w-surface.y*rotation.z);
          float longitude=delta+atan(rotation.x,rotation.y);
          vec2 uv=vec2(fract(longitude/(2.0*PI)+0.5),0.5-latitude/PI);
          vec3 mask=texture2D(world,uv).rgb;
          float illumination=0.70+0.30*clamp(dot(vec3(surface,z),normalize(vec3(-0.4,0.5,1.0))),0.0,1.0);
          vec3 ocean=mix(vec3(0.024,0.102,0.188),vec3(0.086,0.290,0.408),0.55+0.3*surface.y-0.15*surface.x);
          vec3 color=mix(ocean,vec3(0.137,0.345,0.400),mask.r);
          color=mix(color,vec3(0.302,0.541,0.569),mask.g*0.65);
          color=mix(color,vec3(0.46,0.73,0.83),mask.b*0.38)*illumination;
          vec2 code=floor(texture2D(regions,uv).rg*255.0+0.5);
          float country=code.x+code.y*256.0;
          if(countryKeys.y>0.0&&abs(country-countryKeys.y)<0.5)color=mix(color,vec3(0.16,0.52,0.56),0.25);
          if(countryKeys.x>0.0&&abs(country-countryKeys.x)<0.5)color=mix(color,vec3(0.24,0.83,0.80),0.46);
          float rim=smoothstep(0.993,1.0,distance);
          color=mix(color,vec3(0.25,0.67,0.76),rim*0.65);
          float alpha=1.0-smoothstep(1.0-aa,1.0+aa,distance);
          gl_FragColor=vec4(color*alpha,alpha);
        }
      `,
};
