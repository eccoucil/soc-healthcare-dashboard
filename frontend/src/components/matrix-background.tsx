"use client";

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface MatrixBackgroundProps {
  color?: string;
  opacity?: number;
}

export const MatrixBackground: React.FC<MatrixBackgroundProps> = ({ 
  color = "#ff0000", // Default to Tactical Red
  opacity = 0.4
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    // Matrix characters - restricted set for safety
    const charList = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$@%&*";
    const fontSize = 16;
    
    // Create a texture for the characters
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = fontSize * charList.length;
    canvas.height = fontSize;
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    for (let i = 0; i < charList.length; i++) {
      ctx.fillStyle = '#ffffff'; // White characters, tinted by shader
      ctx.fillText(charList[i], i * fontSize, 0);
    }

    const charTexture = new THREE.CanvasTexture(canvas);
    charTexture.minFilter = THREE.NearestFilter;
    charTexture.magFilter = THREE.NearestFilter;

    // Shader material for the matrix rain
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D tChars;
      uniform float uTime;
      uniform float uColumns;
      uniform float uRows;
      uniform vec3 uColor;
      varying vec2 vUv;

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }

      void main() {
        vec2 grid = vec2(uColumns, uRows);
        vec2 ipos = floor(vUv * grid);
        vec2 fpos = fract(vUv * grid);

        float offset = random(vec2(ipos.x, 0.0)) * 10.0;
        float speed = 0.5 + random(vec2(ipos.x, 1.0)) * 1.5;
        float y = mod(ipos.y + uTime * 20.0 * speed + offset, uRows);
        
        // Character selection
        float charIdx = floor(random(vec2(ipos.x, floor(y))) * ${charList.length.toFixed(1)});
        vec2 charUv = vec2((fpos.x + charIdx) / ${charList.length.toFixed(1)}, fpos.y);
        
        vec4 charColor = texture2D(tChars, charUv);
        
        // Fade effect
        float fade = mod(y, uRows) / uRows;
        fade = pow(fade, 3.0); // Sharper falloff

        vec3 finalColor = uColor * charColor.r * fade;
        
        // Add some glowing effect for the lead character
        if (fade > 0.98) {
          finalColor += vec3(0.5, 0.5, 0.5) * charColor.r;
        }

        gl_FragColor = vec4(finalColor, charColor.r * fade);
      }
    `;

    const rows = Math.ceil(height / fontSize);
    const columns = Math.ceil(width / fontSize);
    const geometry = new THREE.PlaneGeometry(width / 100, height / 100);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        tChars: { value: charTexture },
        uTime: { value: 0 },
        uColumns: { value: columns },
        uRows: { value: rows },
        uColor: { value: new THREE.Color(color) }
      },
      vertexShader,
      fragmentShader
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Responsive aspect ratio
    const updateSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      material.uniforms.uColumns.value = Math.ceil(w / fontSize);
      material.uniforms.uRows.value = Math.ceil(h / fontSize);
      mesh.geometry = new THREE.PlaneGeometry(w / 100, h / 100);
    };

    window.addEventListener('resize', updateSize);

    // Animation loop — throttled to ~15fps (decorative effect doesn't need 60fps)
    let animationFrameId: number;
    let lastFrameTime = 0;
    const FRAME_INTERVAL = 66; // ~15fps

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate);
      if (time - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = time;
      material.uniforms.uTime.value = time * 0.001;
      renderer.render(scene, camera);
    };
    animationFrameId = requestAnimationFrame(animate);

    // Pause animation entirely when tab is hidden
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(animationFrameId);
      } else {
        lastFrameTime = 0; // reset so next frame renders immediately
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('resize', updateSize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      charTexture.dispose();
    };
  }, [color]);

  return <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none" style={{ opacity }} />;
};
