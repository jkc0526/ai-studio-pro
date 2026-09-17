// ============ config.js ============

/* YanBa API 聊天模型 */
const YANBA_API_KEY = 'sk-ttrr6oHjFQJAwpV9OTk0ZVW0JVnfPaVKVicWVMuM9GT68wrt';
const YANBA_BASE = 'https://clmm-mall.top';
const YANBA_MODELS = [
  {id:'yanba-gemini-3.1-pro-preview', name:'YanBa Gemini 3.1 Pro', modelId:'gemini-3.1-pro-preview', type:'chat', icon:'🔷', tag:'custom', apiBase:YANBA_BASE, apiKey:YANBA_API_KEY, desc:'Gemini 3.1 Pro'},
  {id:'yanba-gpt-5.6-sol', name:'YanBa GPT-5.6 Sol', modelId:'gpt-5.6-sol', type:'chat', icon:'🟢', tag:'custom', apiBase:YANBA_BASE, apiKey:YANBA_API_KEY, desc:'GPT-5.6 Sol'},
  {id:'yanba-gpt-5.4-mini', name:'YanBa GPT-5.4 Mini', modelId:'gpt-5.4-mini', type:'chat', icon:'🟡', tag:'custom', apiBase:YANBA_BASE, apiKey:YANBA_API_KEY, desc:'GPT-5.4 Mini'},
  {id:'yanba-gemini-3.5-flash', name:'YanBa Gemini 3.5 Flash', modelId:'gemini-3.5-flash', type:'chat', icon:'⚡', tag:'custom', apiBase:YANBA_BASE, apiKey:YANBA_API_KEY, desc:'Gemini 3.5 Flash'},
];

/* ==================== App Version & Changelog ==================== */
const APP_VERSION = '2.2.0';
const CHANGELOG = [
  {
    version: '2.2.0',
    date: '2026-09-04',
    items: [
      '新增：对话助手功能，支持YanBa API的4个聊天模型',
      '新增：侧边栏导航，可切换对话助手/视频生成/图像生成/设置',
      '新增：设置页面，含关于与更新板块（查看版本历史和检测更新）',
      '新增：图像生成和视频生成页面独立显示，不再混在一起',
      '新增：对话界面模型切换器，可随时切换聊天模型',
      '新增：创建任务时按页面类型过滤模型列表',
      '新增：任务卡片显示进度条和进度百分比',
      '修复：视频后台生成成功但前端不显示的问题',
      '修复：任务状态查询代理路径，兼容 /v1/videos/ 和 /v1/tasks/',
      '修复：视频/图片URL提取覆盖更多返回字段格式',
      '优化：轮询超时延长至9分钟，网络错误自动重试'
    ]
  },
  {
    version: '2.1.0',
    date: '2026-09-03',
    items: [
      '新增：支持自定义模型管理',
      '新增：图片/视频生成分离模式',
      '修复：视频生成进度显示问题',
      '优化：任务列表渲染性能'
    ]
  },
  {
    version: '2.0.0',
    date: '2026-09-01',
    items: [
      '全新界面改版',
      '新增：项目管理功能',
      '新增：任务暂存功能',
      '支持图片参考、关键帧、音频参考模式',
      '支持批量生成'
    ]
  }
];

/* ==================== Preset Models ==================== */
const PRESET_MODELS = [
  {id:'img-flash', name:'Image 2.5 Flash', modelId:'agnes-image-2.5-flash', type:'image', tag:'free', icon:'🖼', desc:'1K-4K 图片生成', sizes:['1K','2K','4K'], ratios:['1:1','16:9','9:16','4:3','3:4','3:2','21:9']},
  {id:'vid-flash', name:'Video 2.5 Flash', modelId:'agnes-video-2.5-flash', type:'video', tag:'free', icon:'🎬', desc:'720P 视频', sizes:['720P'], ratios:['16:9','9:16','4:3','1:1','21:9','3:4'], modes:['text','reference','keyframe'], maxImages:5, durations:[4,5,6,7,8,9,10,11,12], supportsAudio:true},
  {id:'vid-full', name:'Video 2.5', modelId:'agnes-video-2.5', type:'video', tag:'paid', icon:'🎥', desc:'720P-2K 视频', sizes:['720P','960P','2K'], ratios:['16:9','9:16','4:3','1:1','21:9','3:4'], modes:['text','reference','keyframe'], maxImages:5, durations:[4,5,6,7,8,9,10,11,12], supportsAudio:true, supportsVideoRef:true}
];

/* ==================== Video Shot Templates ==================== */
const TEMPLATES = [
  {name:'中近景50mm', text:'中近景镜头，50mm焦段，自然景深，人物面部细节清晰，背景柔和虚化，电影质感'},
  {name:'特写85mm', text:'特写镜头，85mm焦段，浅景深，极致细节，主体突出，背景完全虚化，人像摄影风格'},
  {name:'全景24mm', text:'全景广角镜头，24mm焦段，广阔视野，环境交代完整，宏大场景，层次丰富'},
  {name:'推镜头', text:'推镜头，镜头由远及近缓慢推进，逐渐靠近主体，营造聚焦感和紧张感，平滑运动'},
  {name:'拉镜头', text:'拉镜头，镜头由近及远缓慢后拉，逐渐展示全景，揭示环境，营造开阔感'},
  {name:'横移', text:'横移镜头，镜头水平移动，侧面平移展示场景，稳定平滑的运动轨迹'},
  {name:'固定机位', text:'固定机位拍摄，镜头稳定不动，画面构图严谨，适合叙事和对话场景'},
  {name:'手持', text:'手持摄影风格，画面带有自然晃动感，真实纪录片质感，临场感强'},
  {name:'过肩', text:'过肩镜头，从人物肩后方拍摄，前景人物虚化，主体清晰，对话场景常用构图'},
  {name:'荷兰角', text:'荷兰角倾斜构图，画面水平线倾斜，营造不安、紧张或眩晕的视觉心理效果'},
  {name:'俯拍', text:'俯拍镜头，从高处向下拍摄，上帝视角，展示全貌和空间关系，宏大叙事感'},
  {name:'仰拍', text:'仰拍镜头，从低处向上拍摄，主体高大威严，强调力量感和压迫感'}
];

/* ==================== Video Style Presets (视频风格) ==================== */
const VIDEO_STYLES = [
  {name:'无风格',text:''},
  {name:'写实电影',text:'cinematic film look, Hollywood cinematography, film grain, anamorphic lens flare, color grading, shallow depth of field, natural lighting, photorealistic, 4K quality, realistic physics and motion'},
  {name:'日系动画',text:'Japanese anime style, cel-shading, clean line art, vibrant colors, Studio Ghibli aesthetic, soft bloom lighting, expressive characters, detailed backgrounds, smooth 2D animation motion'},
  {name:'3D国漫',text:'Chinese 3D animation style, CG render, Unreal Engine quality, PBR materials, subsurface scattering, volumetric lighting, xianxia fantasy aesthetic, detailed character faces, silk cloth physics, cinematic CG motion'},
  {name:'皮克斯动画',text:'Pixar/Disney 3D animation style, vibrant colors, exaggerated expressions, soft rounded characters, subsurface scattering, warm lighting, family-friendly, stylized yet detailed, smooth cartoon animation'},
  {name:'赛博朋克',text:'cyberpunk aesthetic, neon lights, rain-soaked streets, holographic signs, magenta-cyan color palette, Blade Runner atmosphere, volumetric fog, futuristic technology, lens bokeh, dark sci-fi mood'},
  {name:'复古胶片',text:'vintage film aesthetic, 1980s film stock look, Kodachrome colors, film grain, light leaks, warm sepia tones, soft focus edges, Super 8mm feel, chromatic aberration, nostalgic atmosphere, faded saturation'},
  {name:'纪录片',text:'documentary style, natural handheld camera, realistic lighting, authentic locations, natural color palette, cinéma vérité, raw and unfiltered, real-world textures, observational camera movement'},
  {name:'水墨国风',text:'Chinese ink wash painting animation style, sumi-e ink flowing, xuan paper texture, brush stroke aesthetics, misty mountains, ethereal atmosphere, monochrome with subtle color, traditional guohua painting in motion, poetic atmosphere'},
  {name:'暗黑奇幻',text:'dark fantasy, Gothic atmosphere, moody low-key lighting, medieval ruins, supernatural elements, fog and shadow, candlelight vs cool shadows, dramatic tension, Brothers Grimm aesthetic, cinematic dark mood'}
];

/* ==================== Character Consistency Presets (角色一致性增强词) ==================== */
const CHARACTER_ENHANCERS = [
  {name:'无',text:''},
  {name:'角色一致性（强）',text:'character consistency maintained throughout, same face, same hairstyle, same outfit, same body proportions, character continuity across frames, no face distortion, consistent facial features, consistent clothing colors'},
  {name:'角色一致性（中）',text:'maintain same character appearance, consistent face and outfit'},
  {name:'多人镜头',text:'multiple characters in frame, each character maintains consistent appearance, clear spatial relationship between characters, natural interaction poses, eye-line match'}
];

/* ==================== Camera Motion Presets (运镜增强) ==================== */
const CAMERA_MOTIONS = [
  {name:'无',text:''},
  {name:'缓慢推进',text:'slow dolly in, camera gradually moves closer to subject, smooth push in motion, cinematic'},
  {name:'缓慢拉远',text:'slow dolly out, camera gradually pulls back to reveal wider scene, smooth reveal'},
  {name:'环绕拍摄',text:'orbit shot, camera circles around subject, 360 degree arc movement, parallax effect'},
  {name:'跟拍跟随',text:'tracking shot, camera follows moving subject, steady cam movement, natural following motion'},
  {name:'升降镜头',text:'crane shot, camera rises or descends vertically, revealing environment, dramatic reveal'},
  {name:'摇镜头',text:'pan shot, camera rotates horizontally left or right, scanning across scene'},
  {name:'变焦推近',text:'slow zoom in, focal length changes to magnify subject, Hitchcock zoom feel'},
  {name:'手持晃动',text:'handheld camera, subtle natural shake, documentary realism, cinéma vérité style'}
];

/* ==================== Image Style Templates (20种) ==================== */
const IMAGE_STYLES = [
  {name:'无参考',text:''},
  {name:'写实电影风格',text:'写实电影质感，电影级光影，cinematic lighting, photorealistic, 8K, film grain, shallow depth of field, anamorphic lens flare, color grading, Hollywood cinematography, natural skin texture, realistic physics'},
  {name:'真实3D国漫风格',text:'国产3D动画渲染风格，次世代PBR材质，CG character, Unreal Engine 5 render, subsurface scattering, volumetric lighting, 国漫仙侠质感，精美面部细节，丝滑布料物理，hair strand simulation, ray tracing global illumination'},
  {name:'皮克斯动画风格',text:'Pixar/Disney 3D animation style, vibrant colors, exaggerated expressions, soft rounded character design, subsurface scattering, warm lighting, family-friendly, stylized yet detailed, rim lighting, clean textures, expressive eyes'},
  {name:'国产历史正剧风格',text:'中式历史正剧质感，庄重典雅，authentic Chinese period drama, Ming/Qing dynasty aesthetics, silk brocade textures, traditional architecture, natural earth tones, solemn composition, historical accuracy, soft window light, 工笔画质感'},
  {name:'超写实摄影风格',text:'ultra photorealistic, hyperrealism, 8K RAW photo, Hasselblad medium format, natural lighting, micro-details, skin pores, fabric weave visible, documentary photography, National Geographic style, true-to-life colors, zero artifacts'},
  {name:'商业棚拍风格',text:'commercial studio photography, seamless backdrop, three-point lighting, beauty dish, product shot aesthetic, high-end fashion editorial, crisp shadows, controlled lighting, professional color accuracy, advertising quality, retouched finish'},
  {name:'电影概念设计风格',text:'cinematic concept art, matte painting, epic scale, dramatic chiaroscuro lighting, environmental storytelling, ArtStation trending, Craig Mullins style, atmospheric perspective, volumetric god rays, painterly yet realistic, production design'},
  {name:'日系动画风格',text:'Japanese anime style, cel-shading, clean line art, vibrant saturated colors, Studio Ghibli/Makoto Shinkai aesthetic, detailed backgrounds, expressive eye highlights, soft bloom lighting, lens flare, sakura petals atmosphere, anime motion lines'},
  {name:'国风水墨风格',text:'Chinese ink wash painting style, 水墨晕染, sumi-e, xuan paper texture, flowing brush strokes, misty mountains, negative space composition, monochrome with subtle color accents, traditional guohua aesthetic, 写意山水, ethereal atmosphere'},
  {name:'水彩插画风格',text:'watercolor illustration, soft wet-on-wet bleeding, paper texture visible, delicate color washes, loose brushwork, pastel tones, children\'s book illustration aesthetic, warm and gentle, organic edges, artistic hand-painted feel'},
  {name:'古典油画风格',text:'classical oil painting, Rembrandt lighting, chiaroscuro, rich impasto texture, Renaissance master quality, warm golden tones, dramatic shadows, museum-quality fine art, canvas texture visible, Baroque composition, velvety blacks'},
  {name:'漫画分镜风格',text:'comic/manga panel style, bold ink outlines, screentone shading, dynamic action lines, black and white with accent colors, graphic novel aesthetic, panel borders, expressive character poses, speed lines, dramatic angle composition'},
  {name:'赛博朋克霓虹风格',text:'cyberpunk neon aesthetic, rain-soaked streets, holographic signs, magenta-cyan color palette, Tokyo/Blade Runner atmosphere, volumetric fog, neon reflections on wet surfaces, futuristic technology, chrome and glass, lens bokeh, glitch effects'},
  {name:'科幻概念设计风格',text:'sci-fi concept design, futuristic technology, spacecraft/interstellar, hard surface modeling, H.R. Giger/Syd Mead influence, holographic UI elements, alien landscapes, dystopian/utopian, metallic surfaces with wear, environmental storytelling'},
  {name:'暗黑奇幻风格',text:'dark fantasy, Gothic atmosphere, moody low-key lighting, medieval ruins, supernatural elements, fog and shadow, eldritch horror undertones, candlelight/warm firelight vs cool shadows, ornate details, dramatic tension, Brothers Grimm aesthetic'},
  {name:'复古胶片风格',text:'vintage film aesthetic, 1970s-80s film stock look, Kodachrome/Ektachrome color shift, film grain halation, light leaks, warm sepia tones, soft focus edges, Super 8mm home movie feel, chromatic aberration, nostalgic atmosphere, faded saturation'},
  {name:'黏土定格动画风格',text:'claymation/stop-motion style, Aardman/Wallace & Gromit aesthetic, visible clay texture, thumbprint details, handcrafted sets, slightly jerky motion, warm lighting, tactile materials, charming imperfections, miniatures feel'},
  {name:'低多边形3D风格',text:'low-poly 3D art, geometric faceted surfaces, minimal polygons, flat shading, bold color blocks, isometric perspective often, retro 3D game aesthetic (PS1/N64 era), clean geometric forms, stylized simplicity, vibrant flat colors'},
  {name:'极简扁平插画风格',text:'minimalist flat illustration, clean vector shapes, no gradients or shadows, bold limited color palette, geometric simplicity, modern graphic design aesthetic, negative space, clean lines, corporate/Microsoft design language style, 2D vector art'}
];

/* ==================== Image Composition Templates (12种) ==================== */
const IMAGE_COMPOSITIONS = [
  {name:'无构图',text:''},
  {name:'人物设定图',text:'character design sheet, turnaround reference, front view + side view + back view, full body character, white/neutral background, consistent design, T-pose or natural stance, detailed costume reference, character concept art, orthographic views, model sheet layout'},
  {name:'分镜故事板',text:'storyboard panel layout, cinematic composition, shot-reverse-shot, wide establishing shot + medium shot + close-up sequence, narrative flow, camera angle notes, action lines, director\'s vision, multiple frames showing scene progression, film previsualization, 16:9 aspect per panel'},
  {name:'人物三视图(大头+全身)',text:'character design reference sheet, split layout composition: LEFT SIDE (40% of frame): large close-up portrait/bust shot of the character, detailed face, centered, front-facing, high detail facial features, expression showcase, hair and makeup detail. RIGHT SIDE (60% of frame): full body orthographic turnaround showing 3 views side by side — front view, side profile view, back view, all at same scale, neutral T-pose stance, full body visible head to toe. white clean background, even flat studio lighting, no shadows, consistent character design across all views'},
  {name:'人物三视图(标准)',text:'character turnaround sheet, front view, side profile view, back view, consistent proportions across all angles, neutral standing pose, arms slightly away from body, full body visible, white background, orthographic projection, character model reference sheet, even lighting no shadows'},
  {name:'人物对话6宫格',text:'6-panel dialogue scene composition, shot-reverse-shot editing pattern, two characters facing each other, alternating over-shoulder shots + close-up reaction shots + two-shot medium, eye-line match, 2 rows × 3 columns grid, emotional expression variation, natural conversation flow'},
  {name:'人物对话9宫格',text:'9-panel dialogue scene, 3×3 grid layout, establishing wide shot + over-shoulder shots + extreme close-ups on eyes/hands + reaction shots + two-shot + insert detail shots, dramatic beat progression, emotional arc across panels, varied camera angles, cinematic dialogue sequence'},
  {name:'人物对话12宫格',text:'12-panel dialogue sequence, 3×4 grid, comprehensive scene coverage: establishing shot + character entrances + alternating close-ups + reaction inserts + prop interaction shots + emotional beat close-ups + resolution wide shot, detailed story progression, multiple camera distances and angles'},
  {name:'故事情节6宫格',text:'6-panel narrative storyboard, 2×3 grid, classic narrative structure: setup (1-2) → conflict development (3-4) → climax (5) → resolution (6), each panel advancing the plot, varied shot sizes, visual storytelling without text, clear causal chain between panels, dramatic pacing'},
  {name:'故事情节9宫格',text:'9-panel narrative layout, 3×3 grid, three-act structure across panels: exposition (1-3) → rising action/confrontation (4-6) → climax and resolution (7-9), establishing shots + action sequences + emotional beats + payoff, visual cause-and-effect, character journey visible'},
  {name:'故事情节12宫格',text:'12-panel extended narrative, 3×4 grid, detailed story arc: opening hook → character introduction → setting establishment → inciting incident → rising action ×3 → midpoint twist → complications ×2 → climax → falling action → resolution, rich visual storytelling, scene transitions'},
  {name:'场景四视图',text:'environment/scene concept sheet, four orthographic views: front elevation + side elevation + top-down plan view + perspective 3/4 view, architectural/environmental design reference, consistent scale and proportions, detailed set design, spatial layout reference, neutral lighting, white background'},
  {name:'场景六视图',text:'environment concept design six views: front + left side + right side + top-down plan + perspective 3/4 angle + detail close-up/section view, comprehensive environmental reference, architectural accuracy, prop placement documentation, lighting study included, game-ready environment design sheet'}
];
