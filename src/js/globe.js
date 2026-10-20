/**
 * 交互地球：优先 WebGL，失败后使用 Canvas 2D，再失败显示静态地图。
 * 地形纹理与拾取索引只构建一次；逐帧只更新视角、GPU 采样及稳定 DOM 标签。
 * 坐标单位：经纬度为角度，投影和三角函数内部使用弧度，指针与标签位置使用 CSS 像素。
 */
window.ClockFeatures.createGlobe = async function () {
  'use strict';
  let canvas = document.getElementById('globe');
  const panel = canvas.parentElement;
  const button = document.getElementById('rotate');
  const tip = document.getElementById('cityTooltip');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const DEGREES_TO_RADIANS = Math.PI / 180;
  const countries = window.COUNTRIES || [];
  const countryById = new Map(
    countries.map((country, index) => {
      country.key = index + 1;
      return [country.id, country];
    })
  );
  const capitals = new Set(countries.map((country) => country.capital).filter((id) => id !== null));
  const popular = [
    '北京',
    '东京',
    '新加坡',
    '伦敦',
    '纽约',
    '悉尼',
    '迪拜',
    '巴黎',
    '开罗',
    '莫斯科',
    '孟买',
    '洛杉矶',
    '圣保罗',
    '约翰内斯堡',
  ];
  const land = {
    type: 'MultiPolygon',
    coordinates: (window.LAND || []).map((polygon) =>
      d3.geoArea({ type: 'Polygon', coordinates: polygon }) > 2 * Math.PI
        ? polygon.map((ring) => ring.slice().reverse())
        : polygon
    ),
  };
  const grid = d3.geoGraticule().step([30, 30]).precision(3)();
  const territories = { type: 'GeometryCollection', geometries: countries.map((c) => c.geometry) };
  const regionName = (city) => city.region || city.country;
  /** 把国家整数 key 编码进离屏纹理颜色，读取像素即可快速拾取领土。边界处再进行精确球面包含判断。 */
  async function makeCountryIndex() {
    const image = document.createElement('canvas');
    image.width = 2048;
    image.height = 1024;
    const ctx = image.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const projection = d3
      .geoEquirectangular()
      .translate([1024, 512])
      .scale(2048 / (2 * Math.PI))
      .precision(0.2);
    const path = d3.geoPath(projection, ctx);
    let batchStarted = performance.now();
    for (const country of countries) {
      ctx.beginPath();
      path(country.geometry);
      ctx.fillStyle = `rgb(${country.key & 255},${country.key >> 8},0)`;
      ctx.fill();
      country.bounds = d3.geoBounds(country.geometry);
      if (performance.now() - batchStarted > 8) {
        await ClockLoading.yieldToBrowser();
        batchStarted = performance.now();
      }
    }
    return { image, pixels: ctx.getImageData(0, 0, 2048, 1024).data };
  }
  const countryIndex = await makeCountryIndex();

  /** 预先绘制等距圆柱地图纹理；颜色通道编码陆地、边界和经纬网，交给着色器合成显示。 */
  async function makeTexture() {
    const image = document.createElement('canvas');
    image.width = 2048;
    image.height = 1024;
    const ctx = image.getContext('2d');
    if (!ctx) return null;
    const projection = d3
      .geoEquirectangular()
      .translate([1024, 512])
      .scale(2048 / (2 * Math.PI))
      .precision(0.2);
    const path = d3.geoPath(projection, ctx);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 2048, 1024);
    ctx.beginPath();
    path(land);
    ctx.fillStyle = '#f00';
    ctx.fill();
    ctx.strokeStyle = '#ff8000';
    ctx.lineWidth = 0.65;
    ctx.stroke();
    ctx.beginPath();
    await ClockLoading.yieldToBrowser();
    path(territories);
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    path(grid);
    ctx.strokeStyle = '#000036';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    return image;
  }

  /** 创建 WebGL 渲染器。使用逆正射投影将屏幕球面像素还原为经纬度，再采样本地纹理，避免正面裁剪造成跨球多边形。 */
  async function gpuRenderer() {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    let program, texture, locations;
    let lost = false;
    const image = await makeTexture();
    if (!image) return null;
    /** 编译单个着色器并检查状态；编译失败由外层触发兼容渲染路径。 */
    function shader(type, source) {
      const result = gl.createShader(type);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(result);
        gl.deleteShader(result);
        throw new Error(message);
      }
      return result;
    }
    /** 创建程序、顶点缓冲与纹理绑定；上下文恢复后同样重新执行，旧 GPU 资源不能直接复用。 */
    function initialize() {
      const vertex = shader(gl.VERTEX_SHADER, ClockGlobeShaders.vertex);
      const fragment = shader(gl.FRAGMENT_SHADER, ClockGlobeShaders.fragment);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, countryIndex.image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      locations = Object.fromEntries(
        ['center', 'radius', 'rotation', 'countryKeys'].map((name) => [
          name,
          gl.getUniformLocation(program, name),
        ])
      );
      gl.uniform1i(gl.getUniformLocation(program, 'world'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'regions'), 1);
    }
    initialize();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      initialize();
      lost = false;
      dirty = true;
      wake();
    });
    return {
      name: 'webgl',
      draw(view) {
        if (lost) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(locations.center, view.cx * view.dpr, (view.h - view.cy) * view.dpr);
        gl.uniform1f(locations.radius, view.r * view.dpr);
        gl.uniform4f(locations.rotation, view.sinLon, view.cosLon, view.sinLat, view.cosLat);
        gl.uniform2f(locations.countryKeys, hoverCountry?.key || 0, selectedCountry?.key || 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
    };
  }

  /** 兼容渲染器：仍使用 d3 球面裁剪；缓存渐变与经纬线，避免每帧重复创建可复用对象。 */
  function canvasRenderer() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
    const path = d3.geoPath(projection, ctx);
    let backdrop,
      foreground,
      key = '';
    function layers(view) {
      const { w, h, r, cx, cy, dpr } = view;
      const next = [w, h, r, dpr].join(',');
      if (next === key) return;
      key = next;
      if (!backdrop) {
        backdrop = document.createElement('canvas');
        foreground = document.createElement('canvas');
      }
      for (const layer of [backdrop, foreground]) {
        if (layer.width !== canvas.width || layer.height !== canvas.height) {
          layer.width = canvas.width;
          layer.height = canvas.height;
        }
      }
      const bg = backdrop.getContext('2d'),
        fg = foreground.getContext('2d');
      for (const layer of [bg, fg]) {
        layer.setTransform(dpr, 0, 0, dpr, 0, 0);
        layer.clearRect(0, 0, w, h);
      }
      const halo = bg.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.14);
      halo.addColorStop(0, '#168ba900');
      halo.addColorStop(0.5, '#2bbee52b');
      halo.addColorStop(1, '#0c8ab000');
      bg.fillStyle = halo;
      bg.fillRect(0, 0, w, h);
      const ocean = bg.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx, cy, r * 1.3);
      ocean.addColorStop(0, '#164a68');
      ocean.addColorStop(1, '#061a30');
      bg.beginPath();
      bg.arc(cx, cy, r, 0, Math.PI * 2);
      bg.fillStyle = ocean;
      bg.fill();
      fg.save();
      fg.beginPath();
      fg.arc(cx, cy, r, 0, Math.PI * 2);
      fg.clip();
      const shade = fg.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      shade.addColorStop(0, '#03101a00');
      shade.addColorStop(0.5, '#02101a05');
      shade.addColorStop(1, '#010810b0');
      fg.fillStyle = shade;
      fg.fillRect(0, 0, w, h);
      fg.restore();
      fg.beginPath();
      fg.arc(cx, cy, r, 0, Math.PI * 2);
      fg.strokeStyle = '#50c9e48c';
      fg.lineWidth = 1.4;
      fg.stroke();
    }
    return {
      name: 'canvas2d',
      draw(view) {
        layers(view);
        const { w, h, dpr, lon, lat, r, cx, cy } = view;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(backdrop, 0, 0, w, h);
        projection.rotate([-lon, -lat]).translate([cx, cy]).scale(r);
        ctx.beginPath();
        path(land);
        ctx.fillStyle = '#235866';
        ctx.fill();
        ctx.strokeStyle = '#4d8a91';
        ctx.lineWidth = 0.65;
        ctx.stroke();
        ctx.beginPath();
        path(territories);
        ctx.strokeStyle = '#4d8a9180';
        ctx.lineWidth = 0.6;
        ctx.stroke();
        for (const [country, color] of [
          [selectedCountry, '#3b929955'],
          [hoverCountry, '#4bd8cc88'],
        ])
          if (country) {
            ctx.beginPath();
            path(country.geometry);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#7ef4e8';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        ctx.beginPath();
        path(grid);
        ctx.strokeStyle = '#76bbd430';
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.drawImage(foreground, 0, 0, w, h);
      },
    };
  }

  // ── 渲染器选择与兼容回退 ──────────────────────────────
  let renderer;
  try {
    renderer = await gpuRenderer();
  } catch (error) {
    console.warn('地球加速渲染不可用，将使用兼容模式。', error.message);
  }
  if (!renderer) {
    // WebGL initialization may already own the old canvas context.
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement);
    canvas = replacement;
    renderer = canvasRenderer();
  }
  if (!renderer) {
    canvas.hidden = true;
    canvas.style.display = 'none';
    const fallback = document.getElementById('globeFallback');
    fallback.hidden = false;
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 720 360');
    svg.setAttribute('aria-label', '静态世界大陆地图');
    svg.setAttribute('role', 'img');
    for (const polygon of window.LAND || [])
      for (const ring of polygon) {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute(
          'd',
          ring
            .map(
              ([lo, la], i) =>
                (i ? 'L' : 'M') + ((lo + 180) * 2).toFixed(1) + ',' + ((90 - la) * 2).toFixed(1)
            )
            .join(' ') + 'Z'
        );
        p.setAttribute('fill', '#235866');
        p.setAttribute('stroke', '#4d8a91');
        p.setAttribute('stroke-width', '.5');
        svg.append(p);
      }
    fallback.prepend(svg);
    button.disabled = true;
    document.getElementById('reset').disabled = true;
    return;
  }

  // ── 视角、标签与命中状态 ──────────────────────────────
  const labels = document.createElement('div');
  labels.className = 'globe-labels';
  labels.setAttribute('aria-hidden', 'true');
  panel.append(labels);
  let lon = 100,
    lat = 16,
    zoom = 1,
    targetLon = 100,
    targetLat = 16,
    targetZoom = 1;
  let selected = 0,
    rotate = true,
    autoRotate = true,
    inView = true,
    dirty = true,
    frameId = 0,
    last = 0;
  let hoverCountry = null,
    hoverCity = null,
    selectedCountry = null,
    pointerPosition = null,
    hoverAt = -Infinity,
    tipKind = 'city';
  let width = 1,
    height = 1,
    dpr = 1,
    velocityLon = 0,
    velocityLat = 0,
    dragged = false,
    gesture = null;
  let layoutAt = -Infinity,
    extraLabels = false,
    tipSecond = -1;
  let renderedFrames = 0;
  const frameCosts = [];
  const pointers = new Map(),
    entries = [],
    cityEntries = new Map();
  const hoverTip = document.createElement('div');
  hoverTip.className = 'tooltip globe-hover-tip';
  hoverTip.hidden = true;
  panel.append(hoverTip);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  /** 将经纬度转换为单位球三维向量，供正射投影和正反面判断使用。 */
  function vector(la, lo) {
    const a = la * DEGREES_TO_RADIANS,
      b = lo * DEGREES_TO_RADIANS,
      c = Math.cos(a);
    return [c * Math.sin(b), Math.sin(a), c * Math.cos(b)];
  }
  /** 创建长期保留的标签节点。城市名与首都星标分开，名称过长时不截断星标。 */
  function entry(name, la, lo, city, country = null) {
    const node = document.createElement('div');
    node.className = 'globe-label ' + (city ? 'globe-city' : 'globe-country');
    const content = document.createElement('span');
    content.className = 'globe-label-content';
    if (city) {
      const dot = document.createElement('i');
      dot.className = 'globe-city-dot';
      node.append(dot);
      node.classList.toggle('capital', capitals.has(city.id));
    }
    const text = document.createElement('span');
    text.className = 'globe-label-text';
    if (city) {
      const title = document.createElement('span');
      title.className = 'globe-place-name';
      title.textContent = name;
      text.append(title);
      if (capitals.has(city.id)) {
        const star = document.createElement('span');
        star.className = 'globe-capital-star';
        star.textContent = '★';
        text.append(star);
      }
    } else text.textContent = name;
    content.append(text);
    node.append(content);
    labels.append(node);
    const e = {
      node,
      text,
      vector: vector(la, lo),
      city,
      country,
      shown: false,
      x: 0,
      y: 0,
      z: 0,
      width: Math.max(24, name.length * 12) + 12,
    };
    node.dataset[city ? 'city' : 'country'] = city ? city.id : country.id;
    entries.push(e);
    return e;
  }
  countries.forEach((country) => entry(country.name, country.lat, country.lon, null, country));
  for (const city of CITIES) cityEntries.set(city.id, entry(city.name, city.lat, city.lon, city));
  /** 字体或容器变化后重测标签宽度；让下一帧重新排布，而不是每帧测量 DOM。 */
  function measureLabels() {
    for (const e of entries) e.width = e.text.offsetWidth;
    layoutAt = -Infinity;
    dirty = true;
    wake();
  }
  if (document.fonts) document.fonts.ready.then(measureLabels);
  else measureLabels();
  /** 按钮描述的是下一步操作；aria-pressed 表示用户是否手动暂停。拖拽的临时暂停不改变手动状态。 */
  function updateButton() {
    button.textContent = autoRotate ? 'Ⅱ 停止自转' : '▷ 恢复自转';
    button.setAttribute('aria-pressed', String(!autoRotate));
    button.setAttribute('aria-label', autoRotate ? '停止自转' : '恢复自转');
  }
  /** 仅在可见且无排队帧时启动动画，避免重复 requestAnimationFrame 链。 */
  function wake() {
    if (!frameId && inView && !document.hidden) {
      last = 0;
      frameId = requestAnimationFrame(frame);
    }
  }
  /** 清除惯性角速度，不修改用户的自动旋转偏好。 */
  function stop() {
    velocityLon = velocityLat = 0;
  }
  /** 同步 CSS 尺寸、设备像素比和渲染缓冲尺寸；高分屏仍使用 CSS 坐标定位标签。 */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    dirty = true;
    layoutAt = -Infinity;
    wake();
  }
  /** 集中计算当前投影参数和视角三角函数，一帧内复用，减少重复数学运算。 */
  function view() {
    return {
      w: width,
      h: height,
      dpr,
      lon,
      lat,
      r: Math.min(width * 0.43, height * 0.43) * zoom,
      cx: width / 2,
      cy: height / 2 + 8,
      sinLon: Math.sin(lon * DEGREES_TO_RADIANS),
      cosLon: Math.cos(lon * DEGREES_TO_RADIANS),
      sinLat: Math.sin(lat * DEGREES_TO_RADIANS),
      cosLat: Math.cos(lat * DEGREES_TO_RADIANS),
    };
  }
  /** 投影标签并剔除背面；按悬停、选中、首都等优先级解决碰撞。使用显隐阈值差保持边缘稳定。 */
  function positionLabels(v, t) {
    if (zoom > 1.25) extraLabels = true;
    else if (zoom < 1.12) extraLabels = false;
    for (const e of entries) {
      const [a, b, c] = e.vector,
        along = c * v.cosLon + a * v.sinLon;
      e.x = v.cx + (a * v.cosLon - c * v.sinLon) * v.r;
      e.y = v.cy - (b * v.cosLat - along * v.sinLat) * v.r;
      e.z = b * v.sinLat + along * v.cosLat;
      const front = e.z > 0.03 && e.x > 5 && e.x < width - 5 && e.y > 62 && e.y < height - 58;
      if (e.front !== front) {
        e.front = front;
        e.node.style.visibility = front ? 'visible' : 'hidden';
      }
      // Persistent compositor layers preserve glyph rasterization as their
      // fractional positions move. No per-frame Canvas text rendering.
      if (front) e.node.style.transform = `translate3d(${e.x.toFixed(3)}px,${e.y.toFixed(3)}px,0)`;
    }
    if (t - layoutAt < 100) return;
    layoutAt = t;
    const occupied = [];
    const priority = (e) =>
      e.city
        ? e.city === hoverCity
          ? 2000
          : e.city.id === selected
            ? 1000
            : capitals.has(e.city.id)
              ? 150
              : popular.includes(e.city.name)
                ? 120
                : 70
        : e.country === hoverCountry
          ? 1800
          : 125 + (7 - e.country.rank) * 2;
    const ordered = entries
      .slice()
      .sort((a, b) => priority(b) + (b.shown ? 5 : 0) - (priority(a) + (a.shown ? 5 : 0)));
    for (const e of ordered) {
      const active = e.city && e.city.id === selected;
      e.node.classList.toggle('selected', !!active);
      const eligible = true;
      const margin = e.shown ? 0.5 : 4;
      const box = e.city
        ? { x: e.x + 7, y: e.y - 10, w: e.width, h: 20 }
        : { x: e.x - e.width / 2, y: e.y - 9, w: e.width, h: 18 };
      e.box = box;
      const blocked = occupied.some(
        (o) =>
          box.x < o.x + o.w + margin &&
          box.x + box.w + margin > o.x &&
          box.y < o.y + o.h + margin &&
          box.y + box.h + margin > o.y
      );
      const show =
        eligible &&
        e.z > (e.shown ? 0.08 : 0.18) &&
        box.x > 8 &&
        box.x + box.w < width - 8 &&
        box.y > 62 &&
        box.y + box.h < height - 58 &&
        (!blocked || active);
      if (show) occupied.push(box);
      if (show !== e.shown) {
        e.shown = show;
        e.node.classList.toggle('visible', show);
      }
    }
  }
  /** 按秒刷新打开的时间提示，不重建其 DOM；国家没有首都时不能错误沿用上一次城市。 */
  function updateTip() {
    if (!inView || document.hidden) return;
    const second = Math.floor(Date.now() / 1000);
    if (second === tipSecond) return;
    tipSecond = second;
    if (!tip.hidden)
      writeTip(
        tip,
        tipKind === 'country' ? selectedCountry : null,
        tipKind === 'country' && selectedCountry?.capital === null ? null : CITIES[selected]
      );
    if (!hoverTip.hidden)
      writeTip(
        hoverTip,
        hoverCountry,
        hoverCity || (hoverCountry?.capital !== null ? CITIES[hoverCountry?.capital] : null)
      );
  }
  /** 输出国家/地区、城市、实时时间与 IANA 标识；首都使用星标，名称无背景色。 */
  function writeTip(node, country, city) {
    const name = country?.name || (city ? regionName(city) : '');
    if (node.childElementCount !== 3)
      node.replaceChildren(
        document.createElement('strong'),
        document.createElement('div'),
        document.createElement('small')
      );
    node.children[0].textContent = name;
    if (!city) {
      node.children[1].textContent = '暂无对应城市时间资料';
      node.children[2].textContent = '可使用右侧搜索查询其他城市';
      return;
    }
    const v = ClockTime.view(new Date(), city.zone);
    node.children[1].textContent = city.name + (capitals.has(city.id) ? ' ★' : '') + ' ' + v.time;
    node.children[2].textContent =
      v.date + ' ' + v.weekday + ' · ' + ClockTime.label(v.offset) + ' · ' + city.zone;
  }
  /** 把鼠标所在 CSS 坐标反投影为经纬度；落在球外时返回空值。 */
  // ── 屏幕坐标反投影与对象拾取 ──────────────────────────
  function geographicPoint(x, y, v) {
    const px = (x - v.cx) / v.r,
      py = (v.cy - y) / v.r,
      d = px * px + py * py;
    if (d > 1) return null;
    const z = Math.sqrt(1 - d);
    const la = Math.asin(clamp(py * v.cosLat + z * v.sinLat, -1, 1)) / DEGREES_TO_RADIANS;
    const lo = v.lon + Math.atan2(px, z * v.cosLat - py * v.sinLat) / DEGREES_TO_RADIANS;
    return [((((lo + 180) % 360) + 360) % 360) - 180, la];
  }
  /** 先查颜色索引，必要时用 d3.geoContains 精确判断，降低连续悬停的成本。 */
  function territoryAt(x, y, precise = false) {
    const point = geographicPoint(x, y, view());
    if (!point || !countryIndex) return null;
    const tx = Math.floor(((point[0] + 180) / 360) * 2048) % 2048,
      ty = clamp(Math.floor(((90 - point[1]) / 180) * 1024), 0, 1023);
    const pixel = (ty * 2048 + tx) * 4,
      bytes = countryIndex.pixels;
    const candidate =
      bytes[pixel + 3] > 100 ? countries[bytes[pixel] + bytes[pixel + 1] * 256 - 1] : null;
    if (candidate && (!precise || d3.geoContains(candidate.geometry, point))) return candidate;
    return (
      countries.find((c) => {
        const [[west, south], [east, north]] = c.bounds;
        return (
          point[1] >= south &&
          point[1] <= north &&
          (west <= east
            ? point[0] >= west && point[0] <= east
            : point[0] >= west || point[0] <= east) &&
          d3.geoContains(c.geometry, point)
        );
      }) || null
    );
  }
  /** 命中优先级：城市点/城市文字、国家文字、领土。只允许正面元素参与命中。 */
  function hitAt(x, y, precise = false) {
    const inside = (e) =>
      e.shown &&
      e.box &&
      x >= e.box.x &&
      x <= e.box.x + e.box.w &&
      y >= e.box.y &&
      y <= e.box.y + e.box.h;
    const cityEntry = entries
      .filter((e) => e.city && e.front && (Math.hypot(e.x - x, e.y - y) < 7 || inside(e)))
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (cityEntry)
      return { city: cityEntry.city, country: countryById.get(cityEntry.city.territory) || null };
    const label = entries.find((e) => e.country && e.front && inside(e));
    return { city: null, country: label?.country || territoryAt(x, y, precise) };
  }
  /** 清理悬停状态、提示和视觉高亮，保留独立的选中状态。 */
  function clearHover() {
    if (!hoverCountry && !hoverCity) return;
    for (const e of entries)
      if (e.country === hoverCountry || e.city === hoverCity) e.node.classList.remove('hovered');
    hoverCountry = hoverCity = null;
    hoverTip.hidden = true;
    canvas.style.cursor = 'grab';
    dirty = true;
    layoutAt = -Infinity;
  }
  /** 限制悬停命中频率；视角持续旋转时即使鼠标不移动也要重新计算其下方对象。 */
  function updateHover(t) {
    if (!pointerPosition || pointers.size || t - hoverAt < 80) return;
    hoverAt = t;
    const hit = hitAt(pointerPosition.x, pointerPosition.y);
    if (hit.city !== hoverCity || hit.country !== hoverCountry) {
      clearHover();
      hoverCity = hit.city;
      hoverCountry = hit.country;
      for (const e of entries)
        if ((hoverCity && e.city === hoverCity) || (hoverCountry && e.country === hoverCountry))
          e.node.classList.add('hovered');
      hoverTip.hidden = !hoverCity && !hoverCountry;
      canvas.style.cursor = hoverTip.hidden ? 'grab' : 'pointer';
      tipSecond = -1;
      updateTip();
      layoutAt = -Infinity;
      dirty = true;
    }
    if (!hoverTip.hidden) {
      hoverTip.style.left = clamp(pointerPosition.x + 15, 10, Math.max(10, width - 255)) + 'px';
      hoverTip.style.top = clamp(pointerPosition.y + 18, 62, height - 115) + 'px';
    }
  }
  /** 动画主循环：按时间差自转、平滑靠近目标视角并衰减惯性；后台/离屏不继续消耗帧。 */
  // ── 动画调度 ────────────────────────────────────────
  function frame(t) {
    frameId = 0;
    if (!inView || document.hidden) return;
    const start = performance.now(),
      dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
    last = t;
    rotate = autoRotate && !pointers.size;
    if (rotate) targetLon += dt * 2.5;
    if (!pointers.size && !reducedMotion.matches) {
      targetLon += velocityLon * dt;
      targetLat = clamp(targetLat + velocityLat * dt, -70, 70);
      velocityLon *= Math.exp(-5 * dt);
      velocityLat *= Math.exp(-5 * dt);
      if (Math.abs(velocityLon) < 0.05) velocityLon = 0;
      if (Math.abs(velocityLat) < 0.05) velocityLat = 0;
    }
    const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / (pointers.size ? 0.035 : 0.065));
    lon += (targetLon - lon) * blend;
    lat += (targetLat - lat) * blend;
    zoom += (targetZoom - zoom) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 0.075));
    const moving =
      rotate ||
      Math.abs(targetLon - lon) > 0.0001 ||
      Math.abs(targetLat - lat) > 0.0001 ||
      Math.abs(targetZoom - zoom) > 0.00001 ||
      velocityLon !== 0 ||
      velocityLat !== 0;
    if (dirty || moving) {
      const v = view();
      positionLabels(v, t);
      updateHover(t);
      renderer.draw(v);
      dirty = false;
      renderedFrames++;
    }
    frameCosts.push(performance.now() - start);
    if (frameCosts.length > 180) frameCosts.shift();
    if (moving) frameId = requestAnimationFrame(frame);
    else last = 0;
  }
  /** 统一城市选择入口：更新选中 id、所属领土、提示与可选居中。城市 id 为 0 的北京同样是有效选择。 */
  function focusCity(city, recenter = true, kind = 'city') {
    selected = city.id;
    stop();
    selectedCountry = countryById.get(city.territory) || null;
    tipKind = kind;
    if (!cityEntries.has(selected))
      cityEntries.set(selected, entry(city.name, city.lat, city.lon, city));
    if (recenter) {
      targetLon = lon + ((((city.lon - lon + 540) % 360) + 360) % 360) - 180;
      targetLat = clamp(city.lat - 10, -55, 55);
    }
    tip.hidden = false;
    tip.style.left = '18px';
    tip.style.top = '66px';
    tipSecond = -1;
    updateTip();
    layoutAt = -Infinity;
    dirty = true;
    wake();
  }
  button.onclick = () => {
    autoRotate = !autoRotate;
    rotate = autoRotate && !pointers.size;
    velocityLon = velocityLat = 0;
    if (!autoRotate) {
      targetLon = lon;
      targetLat = lat;
    }
    updateButton();
    dirty = true;
    wake();
  };
  document.getElementById('reset').onclick = () => {
    targetLon = lon + ((((100 - lon + 540) % 360) + 360) % 360) - 180;
    targetLat = 16;
    targetZoom = 1;
    selected = 0;
    tip.hidden = true;
    velocityLon = velocityLat = 0;
    rotate = autoRotate && !pointers.size;
    selectedCountry = null;
    clearHover();
    pointerPosition = null;
    updateButton();
    layoutAt = -Infinity;
    dirty = true;
    wake();
  };
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '世界地球：拖动旋转、滚轮或双指缩放；方向键旋转，加减号缩放；点击城市查看时间'
  );
  /** 开始拖拽/缩放时暂时停转并清除惯性，保留 autoRotate，松手时据此决定是否恢复。 */
  // ── 指针、滚轮及触摸手势 ──────────────────────────────
  function startGesture() {
    const points = [...pointers.values()];
    if (points.length > 1) {
      gesture = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        zoom: targetZoom,
      };
      dragged = true;
    } else if (points.length) {
      gesture = {
        x: points[0].x,
        y: points[0].y,
        startX: points[0].x,
        startY: points[0].y,
        time: performance.now(),
      };
    } else gesture = null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stop();
    clearHover();
    pointerPosition = null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    updateButton();
    if (pointers.size === 1) dragged = false;
    startGesture();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) {
      if (e.pointerType !== 'touch') {
        const rect = canvas.getBoundingClientRect();
        pointerPosition = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        hoverAt = -Infinity;
        updateHover(performance.now());
        wake();
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      const points = [...pointers.values()],
        distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      targetZoom = clamp((gesture.zoom * distance) / Math.max(gesture.distance, 1), 0.7, 1.7);
    } else {
      if (!dragged && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 4)
        return;
      dragged = true;
      tip.hidden = true;
      const now = performance.now(),
        dt = Math.max(8, now - gesture.time) / 1000;
      const factor = 180 / (Math.PI * Math.min(width * 0.43, height * 0.43) * zoom);
      const dx = -(e.clientX - gesture.x) * factor,
        dy = (e.clientY - gesture.y) * factor;
      targetLon += dx;
      targetLat = clamp(targetLat + dy, -70, 70);
      velocityLon = clamp(velocityLon * 0.5 + (dx / dt) * 0.5, -140, 140);
      velocityLat = clamp(velocityLat * 0.5 + (dy / dt) * 0.5, -90, 90);
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      gesture.time = now;
    }
    dirty = true;
    wake();
  });
  /** 结束指针操作：区分点击与拖拽、取消与正常抬手；点击派发 cityselect 供卡片和详情同步。 */
  function release(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const click = !cancelled && !dragged && pointers.size === 1;
    if (cancelled || (gesture && performance.now() - gesture.time > 100))
      velocityLon = velocityLat = 0;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (click) {
      const rect = canvas.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      const hit = hitAt(x, y, true);
      if (hit.city) {
        focusCity(hit.city, false);
        window.dispatchEvent(new CustomEvent('cityselect', { detail: hit.city.id }));
      } else if (hit.country) {
        selectedCountry = hit.country;
        tipKind = 'country';
        if (hit.country.capital !== null) {
          const city = CITIES[hit.country.capital];
          focusCity(city, false, 'country');
          selectedCountry = hit.country;
          tipSecond = -1;
          updateTip();
          window.dispatchEvent(new CustomEvent('cityselect', { detail: city.id }));
        } else {
          tip.hidden = false;
          tip.style.left = '18px';
          tip.style.top = '66px';
          tipSecond = -1;
          updateTip();
          dirty = true;
        }
      }
    }
    velocityLon = velocityLat = 0;
    rotate = autoRotate && !pointers.size;
    startGesture();
    updateButton();
    if (e.pointerType !== 'touch' && !pointers.size) {
      const rect = canvas.getBoundingClientRect();
      pointerPosition = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      hoverAt = -Infinity;
      updateHover(performance.now());
    }
    wake();
  }
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  canvas.addEventListener('pointerleave', () => {
    pointerPosition = null;
    clearHover();
    wake();
  });
  window.addEventListener(
    'scroll',
    () => {
      pointerPosition = null;
      clearHover();
    },
    { passive: true }
  );
  window.addEventListener('blur', () => {
    pointers.clear();
    gesture = null;
    velocityLon = velocityLat = 0;
    rotate = autoRotate;
    pointerPosition = null;
    clearHover();
    updateButton();
    wake();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      stop();
      tip.hidden = true;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
      targetZoom = clamp(targetZoom * Math.exp(-clamp(delta, -240, 240) * 0.0015), 0.7, 1.7);
      dirty = true;
      wake();
    },
    { passive: false }
  );
  canvas.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(e.key)) return;
    e.preventDefault();
    stop();
    tip.hidden = true;
    if (e.key === 'ArrowLeft') targetLon -= 8;
    if (e.key === 'ArrowRight') targetLon += 8;
    if (e.key === 'ArrowUp') targetLat = clamp(targetLat + 8, -70, 70);
    if (e.key === 'ArrowDown') targetLat = clamp(targetLat - 8, -70, 70);
    if (e.key === '+' || e.key === '=') targetZoom = clamp(targetZoom + 0.1, 0.7, 1.7);
    if (e.key === '-') targetZoom = clamp(targetZoom - 0.1, 0.7, 1.7);
    dirty = true;
    wake();
  });
  /** 停止待执行动画帧并重置时间基准，恢复时不会累积后台停留时长。 */
  function suspend() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    last = 0;
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    if (inView) {
      dirty = true;
      wake();
      updateTip();
    } else suspend();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend();
    else {
      dirty = true;
      wake();
      updateTip();
    }
  });
  reducedMotion.addEventListener('change', () => {
    velocityLon = velocityLat = 0;
    dirty = true;
    wake();
  });
  setInterval(updateTip, 1000);
  window.Globe = {
    focus: focusCity,
    diagnostics() {
      return {
        renderer: renderer.name,
        frames: renderedFrames,
        pending: !!frameId,
        rotating: autoRotate && !pointers.size,
        autoRotate,
        hoverCountry: hoverCountry?.id || null,
        hoverCity: hoverCity?.id ?? null,
        selectedCountry: selectedCountry?.id || null,
        labelCount: entries.filter((e) => e.shown).length,
        meanMs: frameCosts.length ? frameCosts.reduce((a, b) => a + b, 0) / frameCosts.length : 0,
        view: { lon, lat, zoom },
        target: { lon: targetLon, lat: targetLat, zoom: targetZoom },
      };
    },
  };
  resize();
  updateButton();
  wake();
};
