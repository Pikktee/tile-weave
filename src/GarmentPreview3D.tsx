import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface GarmentPreview3DProps {
  modelUrl: string;
  image: string;
  repeatSize: number;
  imageFilter?: string;
  previewTool: 'pan' | 'zoom' | 'rotate' | null;
  resetTrigger: number;
  onResetCompleted: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export function GarmentPreview3D({
  modelUrl,
  image,
  repeatSize,
  imageFilter,
  previewTool,
  resetTrigger,
  onResetCompleted,
  zoom,
  onZoomChange,
}: GarmentPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Helper function to apply the texture mapping (wrapped in useCallback to keep it stable)
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

      // repeatSize goes from 6 to 120 (default 32)
      // Map it so smaller repeatSize = more repetitions (smaller tiles), and larger repeatSize = less repetitions (larger tiles)
      const repeatVal = 180 / repeatSize;
      canvasTexture.repeat.set(repeatVal, repeatVal);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;

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
                name.includes('guertel');

              if (!isAccessory) {
                mat.map = canvasTexture;
                // Important: Reset color to white so the pattern's true colors are displayed
                mat.color.setHex(0xffffff);
                mat.needsUpdate = true;
              }
            }
          });
        }
      });
    } catch (e) {
      console.error('Error applying pattern texture to 3D model:', e);
    }
  }, [image, repeatSize, imageFilter]);

  // 1. Initialize Scene, Camera, Renderer, Lights, and OrbitControls
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth || 400;
    const height = containerRef.current.clientHeight || 400;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
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
    controls.minDistance = 1.0;
    controls.maxDistance = 15.0;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight('#fffaed', 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xfffdfa, 0x444444, 0.7);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight('#fffdf5', 0.9);
    dirLight1.position.set(5, 10, 7);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.bias = -0.001;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight('#e2f1ff', 0.4);
    dirLight2.position.set(-5, 5, -7);
    scene.add(dirLight2);

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Window Resize Handler
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
    };
  }, []);

  // Keep a ref of applyPatternTexture so the model loading effect doesn't re-trigger on slider changes
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

    setLoading(true);
    setError(null);

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        modelGroupRef.current = model;

        // Auto-center and normalize scale of the model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Center the model's group
        model.position.sub(center);

        // Scale the model so its max dimension is approximately 1.8 units
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 1.8;
        const scaleFactor = targetSize / (maxDim || 1);
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // Adjust camera position & target based on model size
        if (cameraRef.current && controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          cameraRef.current.position.set(0, 0.2, 2.4);
          controlsRef.current.update();
        }

        // Enable shadows on children meshes
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Generate normals and UVs if missing
            const geometry = mesh.geometry;
            if (geometry) {
              if (!geometry.attributes.normal) {
                geometry.computeVertexNormals();
              }
              if (!geometry.attributes.uv) {
                generateDefaultUVs(geometry);
              }
            }

            // Adjust material for better texture display (white color so pattern color shows correctly)
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.roughness = 0.85; // Fabric is rough
                mat.metalness = 0.1;  // Fabric is non-metallic
              }
            });
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
      cameraRef.current.position.set(0, 0.2, 2.4);
      controlsRef.current.update();
      onResetCompleted();
    }
  }, [resetTrigger, onResetCompleted]);

  // 6. Sync camera distance from zoom prop (Slider -> 3D Camera)
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const targetDistance = zoomToDistance(zoom);
    const currentDistance = camera.position.distanceTo(controls.target);

    // Only update if the difference is meaningful (prevent feedback loop)
    if (Math.abs(currentDistance - targetDistance) > 0.01) {
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(direction, targetDistance);
      controls.update();
    }
  }, [zoom]);

  // 7. Sync zoom state from camera distance (3D Interaction -> Slider)
  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;

    const handleControlsChange = () => {
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
          newDist = Math.max(controls.minDistance || 1.0, Math.min(controls.maxDistance || 15.0, newDist));

          const direction = new THREE.Vector3().subVectors(pos, target).normalize();
          camera.position.copy(target).addScaledVector(direction, newDist);
          controls.update();

          // Also trigger the onChange to sync slider
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', outline: 'none' }} />

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
          style={{ background: 'rgba(255, 252, 246, 0.95)', padding: '20px', textAlign: 'center' }}
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

// Automatically generates cylindrical UV coordinates for meshes that lack UVs
function generateDefaultUVs(geometry: THREE.BufferGeometry) {
  const positionAttribute = geometry.attributes.position;
  if (!positionAttribute) return;

  const count = positionAttribute.count;
  const uvs = new Float32Array(count * 2);

  // Compute bounding box to normalize coordinates
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox || new THREE.Box3();
  const min = bbox.min;
  const size = bbox.getSize(new THREE.Vector3());

  // We use a cylindrical mapping around the Y-axis
  for (let i = 0; i < count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);

    // U: angle around Y-axis normalized to [0, 1]
    const angle = Math.atan2(z, x); // angle in radians [-PI, PI]
    const u = (angle + Math.PI) / (2 * Math.PI);

    // V: height along Y-axis normalized to [0, 1]
    const v = size.y > 0 ? (y - min.y) / size.y : 0.5;

    // Apply repeat scaling factor inside the UV calculations
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.attributes.uv.needsUpdate = true;
}

// Piecewise linear mapping between 1D zoom factor [0.5, 10.0] and 3D camera distance [1.0, 15.0]
// Default distance is 2.4 when zoom is 1.0.
function zoomToDistance(zoom: number): number {
  if (zoom >= 1.0) {
    // Zoom in range [1.0, 10.0] maps to distance [2.4, 1.0]
    return 2.4 - (zoom - 1.0) * (2.4 - 1.0) / (10.0 - 1.0);
  } else {
    // Zoom out range [0.5, 1.0) maps to distance (2.4, 15.0]
    return 2.4 + (1.0 - zoom) * (15.0 - 2.4) / (1.0 - 0.5);
  }
}

function distanceToZoom(distance: number): number {
  if (distance <= 2.4) {
    // Distance [1.0, 2.4] maps to zoom [10.0, 1.0]
    return 1.0 + (2.4 - distance) * (10.0 - 1.0) / (2.4 - 1.0);
  } else {
    // Distance (2.4, 15.0] maps to zoom [1.0, 0.5]
    return 1.0 - (distance - 2.4) * (1.0 - 0.5) / (15.0 - 2.4);
  }
}

