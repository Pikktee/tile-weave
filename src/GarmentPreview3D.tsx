import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Play, Pause } from 'lucide-react';

interface GarmentPreview3DProps {
  modelUrl: string;
  image: string;
  repeatSize: number;
  offsetX?: number;
  offsetY?: number;
  imageFilter?: string;
  previewTool: 'pan' | 'zoom' | 'rotate' | null;
  resetTrigger: number;
  onResetCompleted: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  showMannequin?: boolean;
  materialPreset: 'standard' | 'linen' | 'silk' | 'sport';
  lightingPreset: 'standard' | 'showroom' | 'sunset' | 'neon';
}

interface CustomShaderUniforms {
  uWeaveScale: { value: number };
  uWeaveWeight: { value: number };
  uWeaveType: { value: number };
  uBleedThrough: { value: number };
  uInertia: { value: number };
  uMinY: { value: number };
  uMaxY: { value: number };
}

const applyTextureTransform = (
  texture: THREE.Texture | null,
  repeatSize: number,
  offsetX = 50,
  offsetY = 50,
) => {
  if (!texture) return;

  // repeatSize goes from 6 to 120 (default 32)
  // Map so smaller repeatSize = more repetitions, larger = less.
  const repeatVal = 180 / repeatSize;
  texture.repeat.set(repeatVal, repeatVal);
  texture.offset.set((offsetX - 50) / 100, (50 - offsetY) / 100);
  texture.needsUpdate = true;
};

const MATERIAL_SETTINGS = {
  standard: {
    roughness: 0.80,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: '#f5ede0',
    // Kein prozeduraler Weave – Shader-Passes werden via uWeaveWeight > 0.001-Guard übersprungen
    uWeaveScale: 220.0,
    uWeaveWeight: 0.0,
    uWeaveType: 0.0,
    uBleedThrough: 0.18,
  },
  silk: {
    roughness: 0.20,  // very smooth – light spreads wide
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 1.0,       // full satin sheen
    sheenRoughness: 0.12, // tight highlight lobe
    sheenColor: '#ffffff',
    // weave: ultra-fine twill, barely visible, mostly sheen-driven
    uWeaveScale: 600.0,
    uWeaveWeight: 0.06,
    uWeaveType: 0.0,
    uBleedThrough: 0.30,
  },
  linen: {
    roughness: 0.96, // bone-dry matte
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 0.05,
    sheenRoughness: 0.9,
    sheenColor: '#e8dcc8',
    // weave: thick natural yarns with irregularities
    uWeaveScale: 110.0,
    uWeaveWeight: 0.38,
    uWeaveType: 1.0,
    uBleedThrough: 0.06,
  },
  sport: {
    roughness: 0.45,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    sheen: 0.55,  // synthetic micro-fiber sheen
    sheenRoughness: 0.25,
    sheenColor: '#d0e8ff',
    // weave: technical mesh, visible hexagonal apertures
    uWeaveScale: 180.0,
    uWeaveWeight: 0.28,
    uWeaveType: 2.0,
    uBleedThrough: 0.12,
  },
};

const getBackgroundStyle = (preset: 'standard' | 'showroom' | 'sunset' | 'neon') => {
  switch (preset) {
    case 'standard':
      return 'transparent';
    case 'showroom':
      return 'linear-gradient(180deg, rgba(228, 222, 211, 0.12) 0%, rgba(200, 191, 176, 0.24) 100%)';
    case 'sunset':
      return 'linear-gradient(180deg, rgba(252, 224, 199, 0.12) 0%, rgba(243, 166, 131, 0.18) 40%, rgba(87, 75, 144, 0.24) 100%)';
    case 'neon':
      return 'linear-gradient(180deg, rgba(30, 20, 50, 0.15) 0%, rgba(15, 10, 30, 0.3) 100%)';
  }
};

export function GarmentPreview3D({
  modelUrl,
  image,
  repeatSize,
  offsetX = 50,
  offsetY = 50,
  imageFilter,
  previewTool,
  resetTrigger,
  onResetCompleted,
  zoom,
  onZoomChange,
  showMannequin = true,
  materialPreset,
  lightingPreset,
}: GarmentPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const targetDistanceRef = useRef<number>(2.4);
  const isProgrammaticRef = useRef<boolean>(false);
  const textureTransformRef = useRef({ repeatSize, offsetX, offsetY });

  const [isRotating, setIsRotating] = useState<boolean>(false);
  const isRotatingRef = useRef<boolean>(false);
  useEffect(() => {
    isRotatingRef.current = isRotating;
  }, [isRotating]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // References to the scene lights to change them dynamically based on lightingPreset
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const dirLight1Ref = useRef<THREE.DirectionalLight | null>(null);
  const dirLight2Ref = useRef<THREE.DirectionalLight | null>(null);
  const spotLightRef = useRef<THREE.SpotLight | null>(null);

  // Physics state refs for the inertia fabric swing effect
  const lastAngleRef = useRef<number>(0);
  const velocityYRef = useRef<number>(0);
  const inertiaDisplacementRef = useRef<number>(0);
  const inertiaVelocityRef = useRef<number>(0);
  
  // References to compiled shader uniforms to update values dynamically without recompiling
  const shaderUniformsRef = useRef<CustomShaderUniforms[]>([]);
  const lastTimeRef = useRef<number>(0);

  // Helper function to apply the texture via the model's UV mapping.
  const applyPatternTexture = useCallback(async () => {
    const model = modelGroupRef.current;
    if (!model || !image) return;

    try {
      // 1. Process image filters onto a CanvasTexture
      const canvasTexture = await loadFilteredTexture(image, imageFilter);
      if (!canvasTexture || !modelGroupRef.current) return;

      // Dispose of previous texture
      if (textureRef.current) {
        textureRef.current.dispose();
      }
      textureRef.current = canvasTexture;

      // 2. Set wrap & repeat values
      canvasTexture.wrapS = THREE.RepeatWrapping;
      canvasTexture.wrapT = THREE.RepeatWrapping;
      canvasTexture.colorSpace = THREE.SRGBColorSpace;
      applyTextureTransform(
        canvasTexture,
        textureTransformRef.current.repeatSize,
        textureTransformRef.current.offsetX,
        textureTransformRef.current.offsetY,
      );

      // Apply max anisotropy for crisp rendering on angles
      if (rendererRef.current) {
        canvasTexture.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();
      }

      // 3. Traverse model meshes and apply texture (exclude accessories based on name)
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

          materials.forEach((mat) => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              const name = (mat.name || mesh.name || '').toLowerCase();
              // Smart check to avoid putting the tile pattern on metal hooks, belts, shoes, etc.
              const isAccessory =
                name.includes('button') ||
                name.includes('zipper') ||
                name.includes('belt') ||
                name.includes('metal') ||
                name.includes('buckle') ||
                name.includes('hardware') ||
                name.includes('eyelet') ||
                name.includes('sole') ||
                name.includes('shoe') ||
                name.includes('knopf') ||
                name.includes('reissverschluss') ||
                name.includes('guertel') ||
                name.includes('lining') ||
                name.includes('futter') ||
                name.includes('inside') ||
                name.includes('inner') ||
                name.includes('mannequin') ||
                name.includes('body');

              if (!isAccessory) {
                mat.map = canvasTexture;
                mat.color.setHex(0xffffff);
                mat.side = THREE.DoubleSide;
                mat.needsUpdate = true;
              }
            }
          });
        }
      });
    } catch (e) {
      console.error('Error applying pattern texture to 3D model:', e);
    }
  }, [image, imageFilter]);

  // 1. Initialize Scene, Camera, Renderer, Lights, and OrbitControls
  useEffect(() => {
    if (!containerRef.current) return;

    lastTimeRef.current = performance.now();

    const width = containerRef.current.clientWidth || 400;
    const height = containerRef.current.clientHeight || 400;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
    camera.position.set(0, 0, 3.5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Premium lighting and tone mapping settings
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // Remove any previous canvas
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI; // allow full rotation
    controls.minDistance = 0.3;
    controls.maxDistance = 15.0;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight('#fffaed', 0.5);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const hemiLight = new THREE.HemisphereLight(0xfffdfa, 0x444444, 0.7);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const dirLight1 = new THREE.DirectionalLight('#fffdf5', 0.9);
    dirLight1.position.set(5, 10, 7);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.bias = -0.001;
    scene.add(dirLight1);
    dirLight1Ref.current = dirLight1;

    const dirLight2 = new THREE.DirectionalLight('#e2f1ff', 0.4);
    dirLight2.position.set(-5, 5, -7);
    scene.add(dirLight2);
    dirLight2Ref.current = dirLight2;

    const spotLight = new THREE.SpotLight('#ffffff', 0.0, 12.0, Math.PI / 3, 0.8, 1.0);
    spotLight.position.set(0, 5, 3);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    spotLight.shadow.bias = -0.0005;
    scene.add(spotLight);
    spotLightRef.current = spotLight;

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      
      const cam = cameraRef.current;
      const ctrl = controlsRef.current;
      const modelGroup = modelGroupRef.current;

      // Rotate model if autoplay is enabled
      if (modelGroup && isRotatingRef.current) {
        modelGroup.rotation.y += 0.005;
      }

      if (cam && ctrl) {
        const targetDistance = targetDistanceRef.current;
        const currentDistance = cam.position.distanceTo(ctrl.target);
        
        if (Math.abs(currentDistance - targetDistance) > 0.005) {
          const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          let newDistance = targetDistance;
          if (!prefersReducedMotion) {
            newDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, 0.08);
          }
          const direction = new THREE.Vector3().subVectors(cam.position, ctrl.target).normalize();
          
          isProgrammaticRef.current = true;
          cam.position.copy(ctrl.target).addScaledVector(direction, newDistance);
          isProgrammaticRef.current = false;
        } else if (currentDistance !== targetDistance) {
          const direction = new THREE.Vector3().subVectors(cam.position, ctrl.target).normalize();
          
          isProgrammaticRef.current = true;
          cam.position.copy(ctrl.target).addScaledVector(direction, targetDistance);
          isProgrammaticRef.current = false;
        }
        
        ctrl.update();

        // Physics calculation for the inertia fabric swing effect
        const now = performance.now();
        const deltaTime = Math.min((now - lastTimeRef.current) / 1000, 0.1); // clamp to max 100ms
        lastTimeRef.current = now;

        const currentAngle = Math.atan2(cam.position.x - ctrl.target.x, cam.position.z - ctrl.target.z) - (modelGroup ? modelGroup.rotation.y : 0);
        let angleDiff = currentAngle - lastAngleRef.current;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        lastAngleRef.current = currentAngle;

        if (deltaTime > 0.0001) {
          const targetVelocityY = angleDiff / deltaTime;
          velocityYRef.current = THREE.MathUtils.lerp(velocityYRef.current, targetVelocityY, 0.1);
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const k = prefersReducedMotion ? 100.0 : 25.0; // stiffer spring = less displacement
        const c = prefersReducedMotion ? 10.0 : 3.5;   // higher damping
        const externalForce = prefersReducedMotion ? 0.0 : -velocityYRef.current * 0.6;

        const force = -k * inertiaDisplacementRef.current - c * inertiaVelocityRef.current + externalForce;
        inertiaVelocityRef.current += force * deltaTime;
        inertiaVelocityRef.current = THREE.MathUtils.clamp(inertiaVelocityRef.current, -10, 10);
        
        inertiaDisplacementRef.current += inertiaVelocityRef.current * deltaTime;
        inertiaDisplacementRef.current = THREE.MathUtils.clamp(inertiaDisplacementRef.current, -0.2, 0.2);

        // Update uniforms
        shaderUniformsRef.current.forEach((uni) => {
          if (uni.uInertia) {
            uni.uInertia.value = inertiaDisplacementRef.current;
          }
        });
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();    // Window Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      // Dispose textures, geometries, materials
      if (textureRef.current) {
        textureRef.current.dispose();
      }
      ambientLightRef.current = null;
      hemiLightRef.current = null;
      dirLight1Ref.current = null;
      dirLight2Ref.current = null;
      spotLightRef.current = null;
    };
  }, []);

  // 1.1. Dynamic Lighting Presets Effect
  useEffect(() => {
    const ambient = ambientLightRef.current;
    const hemi = hemiLightRef.current;
    const dir1 = dirLight1Ref.current;
    const dir2 = dirLight2Ref.current;
    const spot = spotLightRef.current;
    if (!ambient || !hemi || !dir1 || !dir2 || !spot) return;

    if (lightingPreset === 'standard') {
      ambient.color.set('#fffaed');
      ambient.intensity = 0.6; // Slightly brighter ambient fill

      hemi.color.set('#fffdfa');
      hemi.groundColor.set('#555555');
      hemi.intensity = 0.8; // Clean, natural sky light

      dir1.color.set('#fffdf5');
      dir1.intensity = 1.1; // Direct daylight key light
      dir1.position.set(5, 10, 7);

      dir2.color.set('#e2f1ff');
      dir2.intensity = 0.6; // Soft cool rim light from behind
      dir2.position.set(-5, 5, -7);

      spot.intensity = 0.0;
    } else if (lightingPreset === 'showroom') {
      // Boutique-Schaufenster: enger Overhead-Spot + starkes Gegenlicht für Silhouette
      ambient.color.set('#ffe8cc');
      ambient.intensity = 0.15;

      hemi.color.set('#fff0e0');
      hemi.groundColor.set('#221100');
      hemi.intensity = 0.2;

      dir1.color.set('#ffe8c8');  // warmes Füll-Licht von vorne links
      dir1.intensity = 0.35;
      dir1.position.set(-3, 4, 6);

      dir2.color.set('#e8f4ff');  // kühles, starkes Gegenlicht für Schulter-Silhouette
      dir2.intensity = 1.5;
      dir2.position.set(1, 6, -8);

      spot.color.set('#fff8f0');  // enger Bühnenstrahler von oben
      spot.intensity = 9.0;
      spot.position.set(0, 8, 2);
      spot.distance = 16.0;
      spot.angle = Math.PI / 7;  // sehr enger Strahl
      spot.penumbra = 0.9;       // weiches Randlicht
      spot.decay = 1.5;
    } else if (lightingPreset === 'sunset') {
      // Goldene Stunde: tief stehende Sonne von der Seite, kühle Schatten
      ambient.color.set('#ffcca0');
      ambient.intensity = 0.12;

      hemi.color.set('#ff9a5c');
      hemi.groundColor.set('#180e08');
      hemi.intensity = 0.15;

      dir1.color.set('#ff7a20');  // intensiver flacher Sonnenstrahl
      dir1.intensity = 3.0;
      dir1.position.set(9, 1.5, 4);

      dir2.color.set('#3a5c8a');  // kühles blaues Abendhimmel-Füllicht
      dir2.intensity = 0.85;
      dir2.position.set(-9, 5, 2);

      spot.color.set('#ffb040');  // goldenes Gegenlicht von hinten unten
      spot.intensity = 7.0;
      spot.position.set(-4, 3, -9);
      spot.distance = 17.0;
      spot.angle = Math.PI / 3.5;
      spot.penumbra = 0.7;
      spot.decay = 1.2;
    } else if (lightingPreset === 'neon') {
      // Club-Bühne: dunkle Basis, drei bunte Lichter
      ambient.color.set('#080312');
      ambient.intensity = 0.1;

      hemi.color.set('#001133');
      hemi.groundColor.set('#220011');
      hemi.intensity = 0.05;

      dir1.color.set('#00e0ff');  // kräftiger Cyan-Key von rechts vorne
      dir1.intensity = 2.0;
      dir1.position.set(5, 5, 4);

      dir2.color.set('#ff00cc');  // Magenta-Fill von links
      dir2.intensity = 1.6;
      dir2.position.set(-5, 3, 4);

      spot.color.set('#9900ff');  // violetter Rim-Strahler von hinten
      spot.intensity = 5.5;
      spot.position.set(0, 5, -8);
      spot.distance = 17.0;
      spot.angle = Math.PI / 2.8;
      spot.penumbra = 0.6;
      spot.decay = 1.4;
    }
  }, [lightingPreset]);

  useEffect(() => {
    textureTransformRef.current = { repeatSize, offsetX, offsetY };
    applyTextureTransform(textureRef.current, repeatSize, offsetX, offsetY);
  }, [repeatSize, offsetX, offsetY]);

  // 1.2. Dynamic Material Presets Effect
  useEffect(() => {
    const model = modelGroupRef.current;
    if (!model) return;

    const settings = MATERIAL_SETTINGS[materialPreset];
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshPhysicalMaterial) {
            const name = (mat.name || mesh.name || '').toLowerCase();
            const isAccessory =
              name.includes('button') ||
              name.includes('zipper') ||
              name.includes('belt') ||
              name.includes('metal') ||
              name.includes('buckle') ||
              name.includes('hardware') ||
              name.includes('eyelet') ||
              name.includes('sole') ||
              name.includes('shoe') ||
              name.includes('knopf') ||
              name.includes('reissverschluss') ||
              name.includes('guertel') ||
              name.includes('lining') ||
              name.includes('futter') ||
              name.includes('inside') ||
              name.includes('inner') ||
              name.includes('mannequin') ||
              name.includes('body');

            if (!isAccessory) {
              mat.roughness = settings.roughness;
              mat.metalness = settings.metalness;
              mat.clearcoat = settings.clearcoat;
              mat.clearcoatRoughness = settings.clearcoatRoughness;
              mat.sheen = settings.sheen;
              mat.sheenRoughness = settings.sheenRoughness;
              if (mat.sheenColor) {
                mat.sheenColor.set(settings.sheenColor);
              } else {
                mat.sheenColor = new THREE.Color(settings.sheenColor);
              }
              mat.needsUpdate = true;
            }
          }
        });
      }
    });

    // Update custom uniforms
    shaderUniformsRef.current.forEach((uni) => {
      if (uni.uWeaveScale) uni.uWeaveScale.value = settings.uWeaveScale;
      if (uni.uWeaveWeight) uni.uWeaveWeight.value = settings.uWeaveWeight;
      if (uni.uWeaveType) uni.uWeaveType.value = settings.uWeaveType;
      if (uni.uBleedThrough) uni.uBleedThrough.value = settings.uBleedThrough;
    });
  }, [materialPreset, loading]);

  // Keep a ref of applyPatternTexture so the model loading effect doesn't re-trigger on image changes
  const applyPatternTextureRef = useRef(applyPatternTexture);
  useEffect(() => {
    applyPatternTextureRef.current = applyPatternTexture;
  }, [applyPatternTexture]);

  // 2. Load 3D Model when modelUrl changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !modelUrl) return;

    // Clean up previous model group
    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      modelGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      modelGroupRef.current = null;
    }
    shaderUniformsRef.current = [];

    setLoading(true);
    setError(null);

    // Disable and clear Three.js FileLoader cache to prevent detached ArrayBuffer issues on reload
    THREE.Cache.enabled = false;
    THREE.Cache.clear();

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        modelGroupRef.current = model;

        // 1. Temporarily hide mannequin/body meshes to compute bounding box based only on the garment
        const mannequinVisibilityMap = new Map<THREE.Object3D, boolean>();
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const meshName = (mesh.name || '').toLowerCase();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const isMannequin =
              meshName.includes('mannequin') ||
              meshName.includes('body') ||
              materials.some((mat) => {
                const matName = (mat.name || '').toLowerCase();
                return matName.includes('mannequin') || matName.includes('body');
              });

            if (isMannequin) {
              mannequinVisibilityMap.set(mesh, mesh.visible);
              mesh.visible = false;
            }
          }
        });

        // 2. Reset scale and position of model group to calculate its raw local box
        model.scale.set(1, 1, 1);
        model.position.set(0, 0, 0);
        model.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());

        // 3. Scale the model so its max dimension is targetSize
        const maxDim = Math.max(size.x, size.y, size.z);
        let targetSize = 1.6; // 1.6 leaves a nice ~10% padding on top and bottom
        if (modelUrl.toLowerCase().includes('midi-dress') || modelUrl.toLowerCase().includes('midikleid')) {
          targetSize = 1.85;
        }
        const scaleFactor = maxDim > 0 ? targetSize / maxDim : 1.0;
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // 4. Update matrix world to apply the scale
        model.updateMatrixWorld(true);

        // 5. Compute the box of the SCALED model to get the exact world center
        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

        // 6. Set the group position to perfectly center the scaled model at (0, 0, 0)
        model.position.copy(scaledCenter).multiplyScalar(-1);

        // Visual adjustment for specific models to achieve perfect visual centering
        if (modelUrl.toLowerCase().includes('hoodie')) {
          model.position.y += 0.06; // Shift up slightly since the hood is thin and makes the model look too low
        }

        model.updateMatrixWorld(true);

        // 7. Restore mannequin visibility
        mannequinVisibilityMap.forEach((visible, obj) => {
          obj.visible = visible;
        });

        // Adjust camera position & target based on model size
        if (cameraRef.current && controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          cameraRef.current.position.set(0, 0, 2.4);
          controlsRef.current.update();

          lastAngleRef.current = Math.atan2(cameraRef.current.position.x, cameraRef.current.position.z);
          velocityYRef.current = 0;
          inertiaVelocityRef.current = 0;
          inertiaDisplacementRef.current = 0;
          lastTimeRef.current = performance.now();
        }

        // Clear previous shader uniforms
        shaderUniformsRef.current = [];

        // Enable shadows on children meshes
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Ensure normals exist for lighting
            const geometry = mesh.geometry;
            if (geometry) {
              if (!geometry.attributes.normal) {
                geometry.computeVertexNormals();
              }
              if (!geometry.boundingBox) {
                geometry.computeBoundingBox();
              }
            }
            const localMinY = geometry?.boundingBox ? geometry.boundingBox.min.y : -1.0;
            const localMaxY = geometry?.boundingBox ? geometry.boundingBox.max.y : 1.0;

            // Adjust material for better texture display
            const isArray = Array.isArray(mesh.material);
            const materials = isArray ? (mesh.material as THREE.Material[]) : [mesh.material as THREE.Material];
            console.log("Mesh child:", mesh.name, "isArray:", isArray, "materials:", materials.map(m => m.constructor.name));
            const newMaterials = materials.map((mat) => {
              if (mat instanceof THREE.MeshStandardMaterial) {
                const name = (mat.name || mesh.name || '').toLowerCase();
                const isAccessory =
                  name.includes('button') ||
                  name.includes('zipper') ||
                  name.includes('belt') ||
                  name.includes('metal') ||
                  name.includes('buckle') ||
                  name.includes('hardware') ||
                  name.includes('eyelet') ||
                  name.includes('sole') ||
                  name.includes('shoe') ||
                  name.includes('knopf') ||
                  name.includes('reissverschluss') ||
                  name.includes('guertel') ||
                  name.includes('lining') ||
                  name.includes('futter') ||
                  name.includes('inside') ||
                  name.includes('inner') ||
                  name.includes('mannequin') ||
                  name.includes('body');

                if (!isAccessory) {
                  // Convert MeshStandardMaterial to MeshPhysicalMaterial
                  const physicalMat = new THREE.MeshPhysicalMaterial();
                  THREE.MeshStandardMaterial.prototype.copy.call(physicalMat, mat);

                  physicalMat.roughness = 0.85; // Fabric is rough
                  physicalMat.metalness = 0.1;  // Fabric is non-metallic
                  physicalMat.side = THREE.DoubleSide;

                  // Setup custom uniforms for this material instance
                  const customUniforms = {
                    uWeaveScale: { value: 4000.0 },
                    uWeaveWeight: { value: 0.01 },
                    uWeaveType: { value: 0.0 },
                    uBleedThrough: { value: 0.18 },
                    uInertia: { value: 0.0 },
                    uMinY: { value: localMinY },
                    uMaxY: { value: localMaxY }
                  };
                  shaderUniformsRef.current.push(customUniforms);

                  physicalMat.onBeforeCompile = (shader) => {
                    console.log("onBeforeCompile is running!");
                    // Inject uniforms
                    shader.uniforms.uWeaveScale = customUniforms.uWeaveScale;
                    shader.uniforms.uWeaveWeight = customUniforms.uWeaveWeight;
                    shader.uniforms.uWeaveType = customUniforms.uWeaveType;
                    shader.uniforms.uBleedThrough = customUniforms.uBleedThrough;
                    shader.uniforms.uInertia = customUniforms.uInertia;
                    shader.uniforms.uMinY = customUniforms.uMinY;
                    shader.uniforms.uMaxY = customUniforms.uMaxY;

                    // Inject uniforms and helper functions into fragment shader.
                    // getFabricHeight uses aaSmoothstep (fwidth-based) for anti-aliased thread
                    // profiles. The Nyquist-fade in the bump/color/roughness passes below
                    // ensures the whole effect disappears before aliasing can occur at zoom-out.
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <common>',
                      `#include <common>
                       uniform float uWeaveScale;
                       uniform float uWeaveWeight;
                       uniform float uWeaveType;
                       uniform float uBleedThrough;

                       // Value noise for linen yarn irregularity
                       float hash12(vec2 p) {
                         vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                         p3 += dot(p3, p3.yzx + 33.33);
                         return fract((p3.x + p3.y) * p3.z);
                       }
                       float vnoise(vec2 p) {
                         vec2 i = floor(p);
                         vec2 f = fract(p);
                         vec2 u = f * f * (3.0 - 2.0 * f);
                         return mix(
                           mix(hash12(i),                 hash12(i + vec2(1.0, 0.0)), u.x),
                           mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
                           u.y
                         );
                       }

                       // Anti-aliased band using fwidth so thread edges don't alias
                       float aaSmoothstep(float val, float edge0, float edge1) {
                         float fw = fwidth(val) * 0.5;
                         return smoothstep(edge0 - fw, edge1 + fw, val);
                       }

                       float getFabricHeight(vec2 uv, float scale, float weight, float type) {
                         vec2 p = uv * scale;
                         if (type > 1.5) {
                           // ── Sport: hexagonal mesh apertures ──────────────────────────
                           vec2 hex = p;
                           hex.x += step(1.0, mod(floor(hex.y), 2.0)) * 0.5;
                           vec2 f = fract(hex) - 0.5;
                           float d = length(f);
                           float fw = fwidth(d) * 1.5;
                           float ring = 1.0 - smoothstep(0.28 - fw, 0.28 + fw, d);
                           return ring * 2.0 - 1.0;
                         } else if (type > 0.5) {
                           // ── Linen: irregular plain weave with thick yarn ───────────
                           float noiseU = vnoise(vec2(floor(p.x), uv.y * 3.7)) * 0.3 + 0.85;
                           float noiseV = vnoise(vec2(uv.x * 3.7, floor(p.y))) * 0.3 + 0.85;
                           vec2 cell = floor(p);
                           bool isWarp = mod(cell.x + cell.y, 2.0) < 0.5;
                           vec2 f = fract(p);
                           float profile;
                           if (isWarp) {
                             float edgeW = noiseV * 0.22;
                             float threadProfile = aaSmoothstep(f.y, edgeW, 0.5) - aaSmoothstep(f.y, 0.5, 1.0 - edgeW);
                             profile = threadProfile * (0.5 + 0.5 * aaSmoothstep(f.x, 0.1, 0.9));
                           } else {
                             float edgeW = noiseU * 0.22;
                             float threadProfile = aaSmoothstep(f.x, edgeW, 0.5) - aaSmoothstep(f.x, 0.5, 1.0 - edgeW);
                             profile = threadProfile * (0.5 + 0.5 * aaSmoothstep(f.y, 0.1, 0.9));
                           }
                           return profile * 2.0 - 1.0;
                         } else {
                           // ── Standard / Silk: clean plain weave ───────────────────────
                           vec2 cell = floor(p);
                           bool isWarp = mod(cell.x + cell.y, 2.0) < 0.5;
                           vec2 f = fract(p);
                           float profile;
                           if (isWarp) {
                             float threadProfile = aaSmoothstep(f.y, 0.15, 0.5) - aaSmoothstep(f.y, 0.5, 0.85);
                             profile = threadProfile * (0.5 + 0.5 * sin(f.x * 3.14159));
                           } else {
                             float threadProfile = aaSmoothstep(f.x, 0.15, 0.5) - aaSmoothstep(f.x, 0.5, 0.85);
                             profile = threadProfile * (0.5 + 0.5 * sin(f.y * 3.14159));
                           }
                           return profile * 2.0 - 1.0;
                         }
                       }`
                    );

                    // ── Bump-Pass: Normal-Perturbation ─────────────────────────────────────────
                    // tw_h / tw_fade werden in main() deklariert, damit color_fragment und
                    // roughnessmap_fragment sie ohne weiteren getFabricHeight-Aufruf nutzen
                    // können (spart 2 von 5 Calls = 40 % weniger Berechnungen pro Pixel).
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <normal_fragment_begin>',
                      `#include <normal_fragment_begin>
                       // Shared weave state: computed once, reused in color + roughness passes
                       float tw_h    = 0.0;
                       float tw_fade = 0.0;
                       #ifdef USE_MAP
                       if (uWeaveWeight > 0.001) {
                         vec2 fw = fwidth(vMapUv);
                         float pixelUV = max(fw.x, fw.y);
                         float nyquistFade = 1.0 - smoothstep(0.3, 0.7, pixelUV * uWeaveScale);
                         float distFade   = 1.0 - smoothstep(1.5, 3.0, length(vViewPosition));
                         tw_fade = nyquistFade * distFade;
                         // Center sample: always needed (back-face lining + bump center)
                         tw_h = getFabricHeight(vMapUv, uWeaveScale, uWeaveWeight, uWeaveType);
                         if (gl_FrontFacing && tw_fade > 0.01) {
                           float stepSize = clamp(pixelUV, 0.4 / uWeaveScale, 1.5 / uWeaveScale);
                           float h_dx = getFabricHeight(vMapUv + vec2(stepSize, 0.0), uWeaveScale, uWeaveWeight, uWeaveType);
                           float h_dy = getFabricHeight(vMapUv + vec2(0.0, stepSize), uWeaveScale, uWeaveWeight, uWeaveType);
                           float bumpStr = uWeaveWeight * 15.0 * tw_fade;
                           float derivX  = (h_dx - tw_h) * bumpStr;
                           float derivY  = (h_dy - tw_h) * bumpStr;
                           vec3 helper    = abs(normal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
                           vec3 tangent   = normalize(cross(normal, helper));
                           vec3 bitangent = normalize(cross(normal, tangent));
                           normal = normalize(normal + (tangent * derivX + bitangent * derivY) * 0.25);
                         }
                       }
                       #endif`
                    );

                    // ── Farb-Pass: Futter-Rückseite + Weave-Schattierung ───────────────────────
                    // Nutzt tw_h / tw_fade aus dem Bump-Pass – kein eigener getFabricHeight-Aufruf.
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <color_fragment>',
                      `#include <color_fragment>
                       #ifdef DOUBLE_SIDED
                       if (uWeaveWeight > 0.001) {
                         #ifdef USE_MAP
                         float weave = tw_h * tw_fade;
                         if (!gl_FrontFacing) {
                           // Innenfutter: warmes Off-White, leicht gewebt
                           vec3 liningBase = vec3(0.95, 0.94, 0.92) + weave * 0.5 * uWeaveWeight;
                           diffuseColor.rgb = mix(liningBase, diffuseColor.rgb, uBleedThrough);
                         } else if (tw_fade > 0.0) {
                           // Außenseite: subtile Weave-Schatten/Highlights
                           diffuseColor.rgb *= (1.0 - uWeaveWeight * 0.4) + weave * 0.5 * uWeaveWeight * 0.8;
                         }
                         #else
                         if (!gl_FrontFacing) {
                           diffuseColor.rgb = vec3(0.95, 0.94, 0.92);
                         }
                         #endif
                       } else if (!gl_FrontFacing) {
                         // Kein Weave (standard/silk), trotzdem Futter-Farbe
                         #ifdef USE_MAP
                         diffuseColor.rgb = mix(vec3(0.95, 0.94, 0.92), diffuseColor.rgb, uBleedThrough);
                         #else
                         diffuseColor.rgb = vec3(0.95, 0.94, 0.92);
                         #endif
                       }
                       #endif`
                    );

                    // ── Roughness-Pass: Fadenkuppen etwas glatter ──────────────────────────────
                    // Nutzt tw_h / tw_fade aus dem Bump-Pass – kein eigener getFabricHeight-Aufruf.
                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <roughnessmap_fragment>',
                      `#include <roughnessmap_fragment>
                       if (uWeaveWeight > 0.001 && tw_fade > 0.0) {
                         float microWeave = tw_h * tw_fade;
                         roughnessFactor = clamp(roughnessFactor + microWeave * uWeaveWeight * 2.0, 0.05, 1.0);
                       }`
                    );

                    // Add uniforms declarations inside vertex shader by replacing '#include <common>'
                    shader.vertexShader = shader.vertexShader.replace(
                      '#include <common>',
                      `#include <common>
                       uniform float uInertia;
                       uniform float uMinY;
                       uniform float uMaxY;`
                    );

                    // Replace begin_vertex
                    shader.vertexShader = shader.vertexShader.replace(
                      '#include <begin_vertex>',
                      `#include <begin_vertex>
                       float heightFactor = clamp((uMaxY - position.y) / (uMaxY - uMinY), 0.0, 1.0);
                       float flex = heightFactor * heightFactor;
                       transformed.x += -position.z * uInertia * flex;
                       transformed.z += position.x * uInertia * flex;
                      `
                    );
                  };

                  return physicalMat;
                }
              }
              return mat;
            });

            if (isArray) {
              mesh.material = newMaterials;
            } else {
              mesh.material = newMaterials[0];
            }
          }
        });

        scene.add(model);
        setLoading(false);

        // Apply texture immediately after loading the model
        applyPatternTextureRef.current();
      },
      undefined,
      (err) => {
        console.error('Error loading 3D model:', err);
        setError('Das 3D-Modell konnte nicht geladen werden. Bitte überprüfe das Dateiformat (.glb).');
        setLoading(false);
      }
    );
  }, [modelUrl]);

  // 3. Update texture mapping when image, repeatSize, or imageFilter changes
  useEffect(() => {
    applyPatternTexture();
  }, [applyPatternTexture]);

  // 3.1. Sync mannequin visibility when showMannequin or loading state changes
  useEffect(() => {
    const model = modelGroupRef.current;
    if (!model) return;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const meshName = (mesh.name || '').toLowerCase();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        const isMannequin =
          meshName.includes('mannequin') ||
          meshName.includes('body') ||
          materials.some((mat) => {
            const matName = (mat.name || '').toLowerCase();
            return matName.includes('mannequin') || matName.includes('body');
          });

        if (isMannequin) {
          mesh.visible = showMannequin;
        }
      }
    });
  }, [showMannequin, loading]);

  // 4. Update OrbitControls drag action based on active previewTool
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (previewTool === 'pan') {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    } else if (previewTool === 'zoom') {
      controls.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
    } else if (previewTool === 'rotate') {
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    } else {
      // Fallback/Default: Rotate
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
    controls.update();
  }, [previewTool]);

  // 5. Handle Reset View Trigger
  useEffect(() => {
    if (resetTrigger > 0 && cameraRef.current && controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      cameraRef.current.position.set(0, 0, 2.4);
      controlsRef.current.update();
      onResetCompleted();
    }
  }, [resetTrigger, onResetCompleted]);

  // 6. Sync camera distance from zoom prop (Slider -> 3D Camera)
  useEffect(() => {
    targetDistanceRef.current = zoomToDistance(zoom);
  }, [zoom]);

  // 7. Sync zoom state from camera distance (3D Interaction -> Slider)
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;

    const handleControlsChange = () => {
      if (isProgrammaticRef.current) return;
      const distance = camera.position.distanceTo(controls.target);
      const computedZoom = Number(distanceToZoom(distance).toFixed(2));
      // Only trigger if difference is meaningful
      if (Math.abs(computedZoom - zoom) > 0.01) {
        onZoomChange(computedZoom);
      }
    };

    controls.addEventListener('change', handleControlsChange);
    return () => controls.removeEventListener('change', handleControlsChange);
  }, [zoom, onZoomChange]);

  // 8. Handle click-to-zoom in 3D
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (previewTool !== 'zoom') return;
      if (e.button !== 0) return; // Left click only
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (previewTool !== 'zoom') return;
      if (e.button !== 0) return; // Left click only

      const diffX = e.clientX - startX;
      const diffY = e.clientY - startY;
      const dist = Math.sqrt(diffX * diffX + diffY * diffY);
      const timeDiff = Date.now() - startTime;

      // Click threshold: moved < 5px and duration < 300ms
      if (dist < 5 && timeDiff < 300) {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (camera && controls) {
          const isZoomOut = e.altKey;
          const factor = isZoomOut ? 1.3 : 1 / 1.3;

          const target = controls.target;
          const pos = camera.position;
          const currentDist = pos.distanceTo(target);
          let newDist = currentDist * factor;

          // Clamp to OrbitControls limits
          newDist = Math.max(controls.minDistance ?? 0.3, Math.min(controls.maxDistance ?? 15.0, newDist));

          // Trigger onChange to sync slider, which updates targetDistanceRef.current and initiates a smooth lerp
          const computedZoom = Number(distanceToZoom(newDist).toFixed(2));
          onZoomChange(computedZoom);
        }
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
    };
  }, [previewTool, onZoomChange]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: getBackgroundStyle(lightingPreset),
        transition: 'background 500ms ease',
        borderRadius: '0 0 24px 24px',
        overflow: 'hidden'
      }}
    >
      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', outline: 'none', background: 'transparent' }} />

      {/* Autoplay Button */}
      <button
        className="garment-3d-autoplay-btn"
        onClick={() => setIsRotating((prev) => !prev)}
        title={isRotating ? 'Drehung anhalten' : 'Automatische Drehung starten'}
        aria-label={isRotating ? 'Drehung anhalten' : 'Automatische Drehung starten'}
      >
        {isRotating ? (
          <Pause size={18} strokeWidth={2.5} />
        ) : (
          <Play size={18} strokeWidth={2.5} style={{ marginLeft: '2px' }} />
        )}
      </button>

      {/* Loading Overlay */}
      {loading && (
        <div className="mini-loader-overlay" aria-label="Modell wird geladen">
          <div className="mini-spinner" />
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div
          className="generating-overlay"
          style={{ background: 'rgba(255, 252, 246, 0.95)', padding: '20px', textAlign: 'center', zIndex: 1 }}
        >
          <span style={{ fontSize: '2rem', color: 'var(--coral)' }}>⚠️</span>
          <strong style={{ fontSize: '1.1rem', marginTop: '10px', color: 'var(--ink)' }}>Fehler beim Laden</strong>
          <p style={{ fontSize: '0.84rem', color: 'var(--muted)', maxWidth: '280px', margin: '8px 0 16px' }}>
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

// Helper to load image, apply HTML Canvas 2D filters, and return a THREE.Texture
function loadFilteredTexture(
  imageUrl: string,
  filterString: string | undefined
): Promise<THREE.Texture | null> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Safe cross-origin for data URLs vs external assets
    img.crossOrigin = imageUrl.startsWith('data:') ? '' : 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        resolve(texture);
        return;
      }

      // Apply brightness, contrast, saturation filter directly on the canvas context if present
      if (filterString) {
        ctx.filter = filterString;
      }
      ctx.drawImage(img, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      resolve(texture);
    };

    img.onerror = (e) => {
      reject(e);
    };

    img.src = imageUrl;
  });
}
// Piecewise linear mapping between 1D zoom factor [0.5, 10.0] and 3D camera distance [0.4, 15.0]
// Default distance is 2.4 when zoom is 1.0.
function zoomToDistance(zoom: number): number {
  if (zoom >= 1.0) {
    // Zoom in range [1.0, 10.0] maps to distance [2.4, 0.4]
    return 2.4 - (zoom - 1.0) * (2.4 - 0.4) / (10.0 - 1.0);
  } else {
    // Zoom out range [0.5, 1.0) maps to distance (2.4, 15.0]
    return 2.4 + (1.0 - zoom) * (15.0 - 2.4) / (1.0 - 0.5);
  }
}

function distanceToZoom(distance: number): number {
  if (distance <= 2.4) {
    // Distance [0.4, 2.4] maps to zoom [10.0, 1.0]
    return 1.0 + (2.4 - distance) * (10.0 - 1.0) / (2.4 - 0.4);
  } else {
    // Distance (2.4, 15.0] maps to zoom [1.0, 0.5]
    return 1.0 - (distance - 2.4) * (1.0 - 0.5) / (15.0 - 2.4);
  }
}
