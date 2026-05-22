import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class PhotoSphere {
    // --- STATIC CONSTANTS ---
    static VIEW_STATE = {
        INTRO: 'intro',
        EXPLORE: 'explore',
        FOCUS: 'focus',
        CANVAS: 'canvas'
    };

    /**
     * Khá»i táº¡o Photo Sphere vá»i cáº¥u hÃ¬nh
     * @param {Object} config - Äá»i tÆ°á»£ng cáº¥u hÃ¬nh
     * @param {string[]} config.galleryData - Máº£ng cÃ¡c URL hÃ¬nh áº£nh
     */
    static init(config) {
        if (!config || !config.galleryData || !Array.isArray(config.galleryData) || config.galleryData.length === 0) {
            console.warn('[PhotoSphere] KhÃ´ng thá» khá»i táº¡o - galleryData pháº£i lÃ  máº£ng khÃ´ng rá»ng');
            return null;
        }

        const requiredElements = [
            'canvas-container',
            'loading-screen',
            'intro-overlay',
            'explore-btn',
            'hud-overlay',
            'grid-view-btn',
            'popup-overlay'
        ];

        const missingElements = requiredElements.filter(id => !document.getElementById(id));
        if (missingElements.length > 0) {
            console.warn('[PhotoSphere] KhÃ´ng thá» khá»i táº¡o - thiáº¿u DOM elements:', missingElements);
            return null;
        }

        return new PhotoSphere(config);
    }

    constructor(config) {
        this.galleryData = config.galleryData;
        this.container = document.getElementById('canvas-container');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.startInExplore = Boolean(config.startInExplore);

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.controls = null;
        this.viewState = this.startInExplore ? PhotoSphere.VIEW_STATE.EXPLORE : PhotoSphere.VIEW_STATE.INTRO;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.tempVec = new THREE.Vector3();
        this.isMouseDown = false;

        this.focusedItem = null;
        this.isTransitioning = false;

        this.canvasOffset = new THREE.Vector3(0, 0, 0);
        this.isDragging = false;
        this.prevMouse = { x: 0, y: 0 };
        this.focusedCanvasItem = null;
        this.hoveredItem = null;

        this.targetGroupQuaternion = new THREE.Quaternion();
        this.startGroupQuaternion = new THREE.Quaternion();
        this.focusCameraZ = 0;

        this.lastExplorePos = new THREE.Vector3(0, 0, 50);

        this.updateGridDimensions();
        this.textureCache = [];

        this._init();
    }

    // --- CONFIG HELPERS ---
    isMobile() { return window.innerWidth < 768; }
    getSphereRadius() { return this.isMobile() ? 15 : 22; }
    getExploreDistance() { return this.isMobile() ? 45 : 54; }
    getCanvasCols() { return this.isMobile() ? 15 : 10; }
    getCanvasSpacingX() { return this.isMobile() ? 3.0 : 3.5; }
    getCanvasSpacingY() { return this.isMobile() ? 4.0 : 4; }

    async _init() {
        this.container.innerHTML = '';
        this.container.style.position = 'fixed';
        this.container.style.inset = '0';
        this.container.style.width = '100vw';
        this.container.style.height = '100vh';
        this.container.style.overflow = 'hidden';
        this.container.style.zIndex = '1';

        ['hud-overlay', 'popup-overlay', 'loading-screen', 'intro-overlay'].forEach((id, index) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.position = el.style.position || 'fixed';
                el.style.zIndex = String(20 + index * 10);
            }
        });
        document.querySelectorAll('.backtohome').forEach((el) => {
            el.style.position = el.style.position || 'fixed';
            el.style.zIndex = '40';
        });

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.set(0, 0, this.startInExplore ? this.getExploreDistance() : 0.1);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enablePan = false;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 100;
        this.controls.enabled = this.startInExplore;
        this.controls.enableZoom = true;
        this.controls.enableRotate = true;

        await this.loadTextures();
        await this.createItems();

        if (this.startInExplore) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
            const intro = document.getElementById('intro-overlay');
            const hud = document.getElementById('hud-overlay');
            if (intro) {
                intro.style.opacity = '0';
                intro.style.display = 'none';
            }
            if (hud) {
                hud.style.display = 'flex';
                hud.style.opacity = '1';
            }
        }

        const loader = document.getElementById('loading-screen');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            setTimeout(() => {
                loader.style.display = 'none';
            }, 800);
        }

        window.addEventListener('resize', () => this.onResize());

        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e), { passive: false });
        this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: false });
        this.renderer.domElement.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.renderer.domElement.addEventListener('pointercancel', (e) => this.onPointerUp(e));

        const btn = document.getElementById('explore-btn');
        btn.addEventListener('click', () => {
            this.viewState = PhotoSphere.VIEW_STATE.EXPLORE;
            this.isTransitioning = true;
            this.controls.enabled = true;
            this.controls.enableRotate = true;
            this.controls.enableZoom = true;
            document.getElementById('intro-overlay').style.opacity = '0';
            const hud = document.getElementById('hud-overlay');
            hud.style.display = 'flex';
            setTimeout(() => {
                hud.style.opacity = '1';
            }, 10);
            setTimeout(() => {
                document.getElementById('intro-overlay').style.display = 'none';
            }, 1000);
        });

        const gridBtn = document.getElementById('grid-view-btn');
        gridBtn.addEventListener('click', () => {
            if (this.viewState === PhotoSphere.VIEW_STATE.EXPLORE || this.viewState === PhotoSphere.VIEW_STATE.FOCUS) {
                this.switchToCanvas();
            } else if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
                this.goBackToSphere();
            }
        });

        this.popupOverlay = document.getElementById('popup-overlay');
        this.popupImg = document.getElementById('popup-img');
        this.popupClose = document.getElementById('popup-close');
        this.popupFrame = document.createElement('iframe');
        this.popupFrame.id = 'popup-video';
        this.popupFrame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
        this.popupFrame.setAttribute('allowfullscreen', '');
        this.popupFrame.style.display = 'none';
        this.popupFrame.style.width = 'min(92vw, 960px)';
        this.popupFrame.style.height = 'min(72vh, 540px)';
        this.popupFrame.style.border = '0';
        this.popupFrame.style.borderRadius = '20px';
        this.popupImg.insertAdjacentElement('afterend', this.popupFrame);

        this.popupClose.addEventListener('click', () => {
            this.popupOverlay.style.opacity = '0';
            setTimeout(() => {
                this.popupOverlay.style.display = 'none';
                this.popupFrame.src = '';
            }, 300);
        });

        this.popupOverlay.addEventListener('click', (e) => {
            if (this.isPopupBlocked) return;
            if (e.target === this.popupOverlay) {
                this.popupOverlay.style.opacity = '0';
                setTimeout(() => {
                    this.popupOverlay.style.display = 'none';
                    this.popupFrame.src = '';
                }, 300);
            }
        });

        this.animate();
    }

    switchToCanvas() {
        const item = this.focusedItem;
        this.viewState = PhotoSphere.VIEW_STATE.CANVAS;
        this.isTransitioning = true;
        this.controls.minDistance = 1;
        this.controls.enableRotate = false;
        this.controls.enabled = false;

        const gridBtn = document.getElementById('grid-view-btn');
        gridBtn.innerHTML = `
            <svg class="grid-icon" viewBox="0 0 24 24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Quay láº¡i quáº£ cáº§u
        `;

        document.getElementById('hud-overlay').style.display = 'flex';
        document.getElementById('hud-overlay').style.opacity = '1';

        if (item) {
            this.canvasOffset.copy(item.userData.canvasPos).negate();
            this.group.children.forEach(c => {
                c.renderOrder = 0;
                if (c.material) c.material.depthTest = true;
            });
            item.renderOrder = 9999;
            item.material.depthTest = false;
        }

        this.focusedItem = null;
        this.updateGridDimensions();
    }

    updateGridDimensions() {
        const cols = this.getCanvasCols();
        const spacingX = this.getCanvasSpacingX();
        const spacingY = this.getCanvasSpacingY();
        const minItems = Math.max(100, this.galleryData.length);
        const count = Math.ceil(minItems / cols) * cols;
        const rows = Math.ceil(count / cols);

        this.gridCols = cols;
        this.gridCount = count;
        this.gridWrapW = spacingX * cols;
        this.gridWrapH = spacingY * rows;
        this.gridSpacingX = spacingX;
        this.gridSpacingY = spacingY;
    }

    goBackToSphere() {
        this.viewState = PhotoSphere.VIEW_STATE.EXPLORE;
        this.controls.enableRotate = true;
        this.controls.enabled = true;
        this.focusedItem = null;
        this.focusedCanvasItem = null;
        this.isTransitioning = true;

        this.group.rotation.x = 0;
        this.group.rotation.z = 0;
        this.group.quaternion.setFromEuler(this.group.rotation);

        this.camera.up.set(0, 1, 0);

        const gridBtn = document.getElementById('grid-view-btn');
        gridBtn.innerHTML = `
            <svg class="grid-icon" viewBox="0 0 24 24">
                <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/>
            </svg>
            Xem dáº¡ng lÆ°á»i
        `;

        const hud = document.getElementById('hud-overlay');
        hud.style.display = 'flex';
        setTimeout(() => {
            hud.style.opacity = '1';
        }, 10);

        this.group.children.forEach(c => {
            c.renderOrder = 0;
            if (c.material) c.material.depthTest = true;
        });
    }

    loadTextures() {
        return new Promise((resolve) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.setCrossOrigin('anonymous');

            const galleryItems = this.galleryData.map(item => {
                if (typeof item === 'string') {
                    return { type: 'image', src: item, thumb: item, caption: '' };
                }
                return {
                    type: item.type || 'image',
                    src: item.src || item.thumb || '',
                    thumb: item.thumb || item.src || '',
                    caption: item.caption || ''
                };
            }).filter(item => item.thumb);
            const loaderBar = document.getElementById('loader-bar');
            const loaderStatus = document.getElementById('loader-status');

            let loadedCount = 0;
            const checkDone = () => {
                loadedCount++;
                const progress = (loadedCount / galleryItems.length) * 100;
                if (loaderBar) loaderBar.style.width = `${progress}%`;
                if (loaderStatus) loaderStatus.textContent = `Äang táº£i: ${Math.round(progress)}%`;

                if (loadedCount === galleryItems.length) {
                    setTimeout(resolve, 300);
                }
            };

            const aspect = 4 / 5;

            galleryItems.forEach((galleryItem, i) => {
                textureLoader.load(galleryItem.thumb, (tex) => {
                    const imgAspect = tex.image.width / tex.image.height;
                    if (imgAspect > aspect) {
                        tex.repeat.set(aspect / imgAspect, 1);
                        tex.offset.x = (1 - tex.repeat.x) / 2;
                    } else {
                        tex.repeat.set(1, imgAspect / aspect);
                        tex.offset.y = (1 - tex.repeat.y) / 2;
                    }
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.generateMipmaps = false;
                    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
                    tex.userData = {
                        isLoaded: true,
                        galleryItem
                    };

                    this.textureCache[i] = tex;
                    checkDone();
                }, undefined, () => {
                    console.error('Failed to load texture:', galleryItem.thumb);
                    checkDone();
                });
            });
        });
    }

    async createItems() {
        const itemW = 2;
        const itemH = 2.5;
        const canvasCols = this.getCanvasCols();
        const minItems = Math.max(100, this.galleryData.length);
        const count = Math.ceil(minItems / canvasCols) * canvasCols;
        this.totalItems = count;
        const radius = this.getSphereRadius();

        for (let i = 0; i < count; i++) {
            const index = i + 0.5;
            const phi_p = Math.acos(1 - 2 * index / count);
            const theta_p = Math.PI * (1 + Math.sqrt(5)) * index;

            const x = radius * Math.sin(phi_p) * Math.cos(theta_p);
            const y = radius * Math.sin(phi_p) * Math.sin(theta_p);
            const z = radius * Math.cos(phi_p);

            const col = i % canvasCols;
            const row = Math.floor(i / canvasCols);
            const totalRows = Math.ceil(count / canvasCols);
            const canvasX = (col - (canvasCols - 1) / 2) * this.getCanvasSpacingX();
            const canvasY = -(row - (totalRows - 1) / 2) * this.getCanvasSpacingY();

            const textureIndex = i % this.textureCache.length;
            const texture = this.textureCache[textureIndex];

            const material = texture
                ? new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 1 })
                : new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide, transparent: true, opacity: 1 });

            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(itemW, itemH),
                material
            );

            mesh.position.set(x, y, z);
            mesh.lookAt(x * 2, y * 2, z * 2);

            mesh.userData = {
                spherePos: new THREE.Vector3(x, y, z),
                sphereQuat: mesh.quaternion.clone(),
                canvasPos: new THREE.Vector3(canvasX, canvasY, 0),
                canvasQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
                galleryItem: texture?.userData?.galleryItem || null
            };

            this.group.add(mesh);
        }
    }

    checkIntersection() {
        if (this.isDragging) {
            this.hoveredItem = null;
            document.body.style.cursor = 'grabbing';
            return;
        }

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.group.children);

        const validIntersects = intersects.filter(hit => {
            const worldNormal = new THREE.Vector3(0, 0, 1);
            worldNormal.applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));
            const camDir = new THREE.Vector3().subVectors(this.camera.position, hit.point).normalize();
            return worldNormal.dot(camDir) > 0;
        });

        if (validIntersects.length > 0) {
            document.body.style.cursor = 'pointer';
            this.hoveredItem = validIntersects[0].object;
        } else {
            document.body.style.cursor = this.isDragging ? 'grabbing' : 'default';
            this.hoveredItem = null;
        }
    }

    onPointerDown(e) {
        if (!e.isPrimary) return;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.isMouseDown = true;
        this.isDragging = false;
        this.isInertiaActive = false;
        this.canvasVelocity = new THREE.Vector2(0, 0);

        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.prevMouse = { x: e.clientX, y: e.clientY };
        this.pointerDownTime = performance.now();
        this.lastMoveTime = this.pointerDownTime;
        this.dragDistance = 0;

        this.isTransitioning = false;

        this.dragStartThreshold = this.isMobile() ? 12 : 5;
        this.tapMoveThreshold = this.isMobile() ? 30 : 10;

        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.group.children);
        const validIntersects = intersects.filter(hit => {
            const worldNormal = new THREE.Vector3(0, 0, 1);
            worldNormal.applyQuaternion(hit.object.getWorldQuaternion(new THREE.Quaternion()));
            const camDir = new THREE.Vector3().subVectors(this.camera.position, hit.point).normalize();
            return worldNormal.dot(camDir) > 0;
        });

        if (validIntersects.length > 0) {
            this.pendingCanvasItem = validIntersects[0].object;
        } else {
            this.pendingCanvasItem = null;
        }
    }

    onPointerMove(e) {
        if (!e.isPrimary) return;
        if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
            e.preventDefault();
        }

        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        if (this.isMouseDown) {
            const dx = e.clientX - this.prevMouse.x;
            const dy = e.clientY - this.prevMouse.y;
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);

            if (!this.isDragging && dist > this.dragStartThreshold) {
                if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
                    this.isDragging = true;
                    this.isTransitioning = false;
                    document.body.style.cursor = 'grabbing';
                }
            }

            if (this.isDragging && this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
                const now = performance.now();
                let dt = now - this.lastMoveTime;
                if (dt < 1) dt = 1;

                const fovRad = (this.camera.fov * Math.PI) / 180;
                const visibleHeightAtDist = 2 * Math.tan(fovRad / 2) * this.camera.position.z;
                const dynamicSensitivity = visibleHeightAtDist / window.innerHeight;

                this.canvasOffset.x += dx * dynamicSensitivity;
                this.canvasOffset.y -= dy * dynamicSensitivity;

                const vx = (dx * dynamicSensitivity) / dt;
                const vy = (dy * dynamicSensitivity) / dt;

                const alpha = 0.35;
                if (!this.canvasVelocity) this.canvasVelocity = new THREE.Vector2(0, 0);

                this.canvasVelocity.x = THREE.MathUtils.lerp(this.canvasVelocity.x, vx, alpha);
                this.canvasVelocity.y = THREE.MathUtils.lerp(this.canvasVelocity.y, vy, alpha);

                this.lastMoveTime = now;
                this.prevMouse = { x: e.clientX, y: e.clientY };
            }
        } else {
            this.checkIntersection();
        }
    }

    onPointerUp(e) {
        if (!e.isPrimary) return;
        this.renderer.domElement.releasePointerCapture(e.pointerId);
        this.isMouseDown = false;
        document.body.style.cursor = 'default';

        const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);

        if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvasVelocity.set(0, 0);
                this.isInertiaActive = false;
            } else {
                if (dist <= this.tapMoveThreshold && this.pendingCanvasItem) {
                    this.showPopup(this.pendingCanvasItem);
                } else if (!this.pendingCanvasItem) {
                    this.focusedCanvasItem = null;
                }
            }
        } else {
            if (dist <= this.tapMoveThreshold) {
                if (this.pendingCanvasItem) {
                    this.handleSphereInteraction(this.pendingCanvasItem);
                } else if (this.viewState === PhotoSphere.VIEW_STATE.FOCUS) {
                    this.goBackToSphere();
                }
            }
        }

        this.pendingCanvasItem = null;
    }

    handleSphereInteraction(item) {
        if (this.viewState === PhotoSphere.VIEW_STATE.EXPLORE) {
            this.showPopup(item);
        }
        else if (this.viewState === PhotoSphere.VIEW_STATE.FOCUS) {
            if (this.focusedItem === item) {
                this.switchToCanvas();
            } else {
                this.focusedItem = item;
                this.isTransitioning = true;
            }
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = performance.now() * 0.001;

        if (this.viewState === PhotoSphere.VIEW_STATE.INTRO) {
            this.group.rotation.y += 0.0005;
            this.group.rotation.x += 0.0002;
        } else if (this.viewState === PhotoSphere.VIEW_STATE.EXPLORE) {
            this.group.rotation.y += 0.002;
            this.group.rotation.x = Math.sin(time * 0.2) * 0.1;

            if (!this.isTransitioning) {
                this.controls.target.set(0, 0, 0);
            }
        } else if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
            this.group.rotation.x *= 0.9;
            this.group.rotation.y *= 0.9;
            this.group.rotation.z *= 0.9;
            if (Math.abs(this.group.rotation.x) < 0.001) this.group.rotation.x = 0;
            if (Math.abs(this.group.rotation.y) < 0.001) this.group.rotation.y = 0;
            if (Math.abs(this.group.rotation.z) < 0.001) this.group.rotation.z = 0;
        }

        if (this.viewState === PhotoSphere.VIEW_STATE.FOCUS && this.focusedItem) {
            this.group.quaternion.slerp(this.targetGroupQuaternion, 0.08);
            this.group.rotation.setFromQuaternion(this.group.quaternion);
            const targetCam = new THREE.Vector3(0, 0, this.focusCameraZ);
            this.camera.position.lerp(targetCam, 0.1);
            const targetLook = new THREE.Vector3(0, 0, this.getSphereRadius());
            this.controls.target.lerp(targetLook, 0.1);
            this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.1);
            if (this.camera.position.distanceTo(targetCam) < 0.1 && this.group.quaternion.angleTo(this.targetGroupQuaternion) < 0.01) {
                this.isTransitioning = false;
            }
        }
        else if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
            let targetPos = new THREE.Vector3(0, 0, 4.5);
            if (this.focusedCanvasItem) {
                const fovRad = (this.camera.fov * Math.PI) / 180;
                let dist;
                const meshW = 2;
                const meshH = 2.5;
                const aspect = this.camera.aspect;
                if (aspect < (meshW / meshH)) {
                    const visibleH = (meshW / 0.8) / aspect;
                    dist = visibleH / (2 * Math.tan(fovRad / 2));
                } else {
                    dist = (meshH / 0.8) / (2 * Math.tan(fovRad / 2));
                }
                targetPos.set(this.focusedCanvasItem.position.x, this.focusedCanvasItem.position.y, dist);
            }
            else if (this.isDragging) {
                targetPos.z = 5.5;
            }
            this.camera.position.lerp(targetPos, 0.08);
            if (!this.focusedCanvasItem) {
                this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.08);
            }
            this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.1);
            if (!this.isDragging && !this.focusedCanvasItem && this.camera.position.distanceTo(new THREE.Vector3(0, 0, 4.5)) < 0.01) {
                this.isTransitioning = false;
            }
        }
        else if (this.viewState === PhotoSphere.VIEW_STATE.EXPLORE && this.isTransitioning) {
            const targetPos = (this.lastExplorePos.lengthSq() > 0 && this.lastExplorePos.z !== 0.1)
                ? this.lastExplorePos
                : new THREE.Vector3(0, 0, this.getExploreDistance());
            const targetDist = targetPos.length();
            const currentDist = this.camera.position.length();
            if (currentDist > 10) { this.controls.enabled = true; }
            this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.1);
            if (Math.abs(currentDist - targetDist) > 0.5) {
                const nextDist = THREE.MathUtils.lerp(currentDist, targetDist, 0.03);
                this.camera.position.setLength(nextDist);
            } else {
                this.isTransitioning = false;
                this.controls.minDistance = 10;
                this.controls.target.set(0, 0, 0);
            }
            this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.1);
        }

        const clock = this.clock || (this.clock = new THREE.Clock());
        const deltaTime = Math.min(0.05, clock.getDelta());

        this.group.children.forEach(mesh => {
            if (this.viewState === PhotoSphere.VIEW_STATE.CANVAS) {
                const wrapW = this.gridWrapW;
                const wrapH = this.gridWrapH;
                let tx = mesh.userData.canvasPos.x + this.canvasOffset.x;
                let ty = mesh.userData.canvasPos.y + this.canvasOffset.y;
                tx = ((tx + wrapW / 2) % wrapW + wrapW) % wrapW - wrapW / 2;
                ty = ((ty + wrapH / 2) % wrapH + wrapH) % wrapH - wrapH / 2;
                this.tempVec.set(tx, ty, 0);
                const target = this.tempVec;
                const useLerp = (this.isTransitioning && !this.isDragging && !this.isInertiaActive);
                if (useLerp) {
                    mesh.position.lerp(target, 0.15);
                    mesh.material.opacity = THREE.MathUtils.lerp(mesh.material.opacity, 1, 0.15);
                    const s = THREE.MathUtils.lerp(mesh.scale.x, 1, 0.15);
                    mesh.scale.setScalar(s);
                } else {
                    mesh.position.copy(target);
                    mesh.material.opacity = 1;
                    let scaleTarget = 1;
                    if (!this.focusedCanvasItem && mesh === this.hoveredItem) {
                        scaleTarget = 1.15;
                    }
                    mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, scaleTarget, 0.1));
                }
                mesh.quaternion.slerp(mesh.userData.canvasQuat, 0.1);
            }
            else {
                mesh.position.lerp(mesh.userData.spherePos, 0.07);
                mesh.material.opacity = 1;
                mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
                if (this.viewState === PhotoSphere.VIEW_STATE.FOCUS && mesh === this.focusedItem) {
                    mesh.lookAt(this.camera.position);
                } else {
                    mesh.quaternion.slerp(mesh.userData.sphereQuat, 0.07);
                }
            }
        });

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    showPopup(item) {
        if (!item || !item.material || !item.material.map) return;
        const galleryItem = item.userData.galleryItem || item.material.map.userData.galleryItem || {};
        const texture = item.material.map;
        const image = texture.image;
        if (!image && !galleryItem.src) return;

        if (galleryItem.type === 'video') {
            this.popupImg.style.display = 'none';
            this.popupImg.src = '';
            this.popupFrame.style.display = 'block';
            this.popupFrame.src = galleryItem.src;
        } else {
            this.popupFrame.style.display = 'none';
            this.popupFrame.src = '';
            this.popupImg.style.display = 'block';
            this.popupImg.src = galleryItem.src || image.src;
        }

        this.popupOverlay.style.display = 'flex';
        this.isPopupBlocked = true;
        setTimeout(() => { this.isPopupBlocked = false; }, 200);
        this.hoveredItem = null;
        document.body.style.cursor = 'default';
        requestAnimationFrame(() => { this.popupOverlay.style.opacity = '1'; });
    }
}

// Attach to window for global access as requested
window.PhotoSphere = PhotoSphere;

