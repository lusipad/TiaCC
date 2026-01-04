/**
 * DotPlot - Coverage Risk Matrix with Module Aggregation
 * Supports 5000-10000+ nodes through module-level aggregation and zoom/pan
 */
window.dotPlot = {
    canvas: null,
    ctx: null,
    data: [],           // Raw file-level data
    modules: [],        // Aggregated module data
    width: 0,
    height: 0,
    hoveredItem: null,
    selectedItem: null,
    dotNetRef: null,
    expandedModule: null, // Currently expanded module (null = show all aggregated)

    // Spatial index for fast hit testing
    quadtree: null,
    moduleQuadtree: null,

    // View Transform (zoom/pan)
    transform: {
        scale: 1.0,
        offsetX: 0,
        offsetY: 0
    },

    // Interaction state
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    lastTransform: { offsetX: 0, offsetY: 0 },

    // Constants
    PADDING: 50,
    MIN_ZOOM: 0.5,
    MAX_ZOOM: 10,
    ZOOM_SENSITIVITY: 0.001,
    AGGREGATE_THRESHOLD: 2.0, // Zoom level below which to show aggregated view

    init: function (container, data, dotNetRef) {
        // Cleanup previous if exists
        if (this.container && this.container.innerHTML !== '') {
            this.container.innerHTML = '';
        }

        this.container = container;
        this.data = data;
        this.dotNetRef = dotNetRef;
        this.selectedItem = null;
        this.expandedModule = null;
        this.resetTransform();

        // Compute module aggregation
        this.computeModuleAggregation();

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.cursor = 'grab';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Event listeners
        this.bindEvents();
        this.resize();
    },

    bindEvents: function() {
        // Resize
        this._resizeHandler = () => this.resize();
        window.addEventListener('resize', this._resizeHandler);

        // Mouse events
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this.onMouseLeave());
        this.canvas.addEventListener('click', (e) => this.onClick(e));
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

        // Zoom (wheel)
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Pan (drag)
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
    },

    resetTransform: function() {
        this.transform = { scale: 1.0, offsetX: 0, offsetY: 0 };
    },

    computeModuleAggregation: function() {
        // Group data by module
        const moduleMap = new Map();

        this.data.forEach(item => {
            const modName = item.moduleName || 'Unknown';
            if (!moduleMap.has(modName)) {
                moduleMap.set(modName, {
                    moduleName: modName,
                    files: [],
                    totalCoverage: 0,
                    totalTestCount: 0,
                    avgCoverage: 0,
                    avgTestCount: 0,
                    fileCount: 0
                });
            }
            const mod = moduleMap.get(modName);
            mod.files.push(item);
            mod.totalCoverage += item.coverage;
            mod.totalTestCount += item.testCount;
            mod.fileCount++;
        });

        // Compute averages (centroid position)
        this.modules = Array.from(moduleMap.values()).map(mod => {
            mod.avgCoverage = mod.totalCoverage / mod.fileCount;
            mod.avgTestCount = mod.totalTestCount / mod.fileCount;
            // Screen coordinates will be computed during draw
            mod._x = 0;
            mod._y = 0;
            return mod;
        });

        // Sort by file count for consistent rendering
        this.modules.sort((a, b) => b.fileCount - a.fileCount);
    },

    /**
     * Build Quadtree spatial index for fast hit testing
     * Called after drawing when coordinates are computed
     */
    buildQuadtrees: function() {
        if (typeof Quadtree === 'undefined') {
            console.warn('Quadtree not loaded, using linear search');
            return;
        }

        const bounds = { x: 0, y: 0, width: this.width, height: this.height };

        // Build file quadtree
        this.quadtree = new Quadtree(bounds, 10);
        this.data.forEach(item => {
            if (item._x !== undefined && item._y !== undefined) {
                this.quadtree.insert(item);
            }
        });

        // Build module quadtree
        this.moduleQuadtree = new Quadtree(bounds, 5);
        this.modules.forEach(mod => {
            if (mod._x !== undefined && mod._y !== undefined) {
                this.moduleQuadtree.insert(mod);
            }
        });
    },

    resize: function () {
        if (!this.container) return;

        const rect = this.container.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;

        // Handle high DPI
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        this.ctx.scale(dpr, dpr);

        this.draw();
    },

    // Coordinate transforms
    dataToScreen: function(dataX, dataY, maxTests) {
        const chartW = this.width - this.PADDING * 2;
        const chartH = this.height - this.PADDING * 2;

        // Data to chart coordinates
        let x = this.PADDING + (dataX / maxTests * chartW);
        let y = (this.height - this.PADDING) - (dataY / 100 * chartH);

        // Apply zoom/pan transform
        x = (x - this.width / 2) * this.transform.scale + this.width / 2 + this.transform.offsetX;
        y = (y - this.height / 2) * this.transform.scale + this.height / 2 + this.transform.offsetY;

        return { x, y };
    },

    screenToData: function(screenX, screenY, maxTests) {
        const chartW = this.width - this.PADDING * 2;
        const chartH = this.height - this.PADDING * 2;

        // Reverse transform
        let x = (screenX - this.width / 2 - this.transform.offsetX) / this.transform.scale + this.width / 2;
        let y = (screenY - this.height / 2 - this.transform.offsetY) / this.transform.scale + this.height / 2;

        // Chart to data coordinates
        const dataX = ((x - this.PADDING) / chartW) * maxTests;
        const dataY = ((this.height - this.PADDING - y) / chartH) * 100;

        return { x: dataX, y: dataY };
    },

    draw: function () {
        if (!this.ctx) return;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Draw axes (fixed, not affected by zoom)
        this.drawAxes(ctx);

        if (this.data.length === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data matching filters', this.width / 2, this.height / 2);
            return;
        }

        // Calculate scale
        const maxTests = Math.max(...this.data.map(d => d.testCount), 10);

        // Decide view mode based on zoom level and expanded module
        if (this.expandedModule) {
            // Show files of expanded module
            this.drawExpandedModule(ctx, maxTests);
        } else if (this.transform.scale < this.AGGREGATE_THRESHOLD) {
            // Aggregated module view
            this.drawModuleAggregates(ctx, maxTests);
        } else {
            // File-level view (when zoomed in enough)
            this.drawAllFiles(ctx, maxTests);
        }

        // Draw zoom indicator
        this.drawZoomIndicator(ctx);

        // Tooltip
        if (this.hoveredItem) {
            this.drawTooltip(this.hoveredItem);
        }

        // Rebuild spatial index after coordinates are updated
        this.buildQuadtrees();
    },

    drawAxes: function(ctx) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Test Impact (Count)', this.width / 2, this.height - 10);

        ctx.save();
        ctx.translate(15, this.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Coverage (%)', 0, 0);
        ctx.restore();

        // Axes lines
        ctx.beginPath();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.moveTo(this.PADDING, this.PADDING);
        ctx.lineTo(this.PADDING, this.height - this.PADDING);
        ctx.lineTo(this.width - this.PADDING, this.height - this.PADDING);
        ctx.stroke();

        // Grid lines (coverage levels)
        ctx.strokeStyle = '#f1f5f9';
        ctx.setLineDash([4, 4]);
        [25, 50, 75, 100].forEach(cov => {
            const y = (this.height - this.PADDING) - (cov / 100 * (this.height - this.PADDING * 2));
            ctx.beginPath();
            ctx.moveTo(this.PADDING, y);
            ctx.lineTo(this.width - this.PADDING, y);
            ctx.stroke();

            // Label
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${cov}%`, this.PADDING - 5, y + 3);
        });
        ctx.setLineDash([]);
    },

    drawModuleAggregates: function(ctx, maxTests) {
        this.modules.forEach(mod => {
            const pos = this.dataToScreen(mod.avgTestCount, mod.avgCoverage, maxTests);
            mod._x = pos.x;
            mod._y = pos.y;

            // Skip if outside visible area
            if (pos.x < -50 || pos.x > this.width + 50 || pos.y < -50 || pos.y > this.height + 50) {
                return;
            }

            // Radius based on file count (log scale)
            const baseRadius = 8;
            const radius = baseRadius + Math.log(mod.fileCount + 1) * 6;

            // Color based on average coverage
            const color = this.getCoverageColor(mod.avgCoverage, 0.7);

            ctx.beginPath();

            // Selection ring
            if (this.selectedItem && this.selectedItem.moduleName === mod.moduleName && !this.selectedItem.fileName) {
                ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
                ctx.fill();
                ctx.beginPath();
            }

            // Hover effect
            const isHovered = this.hoveredItem && this.hoveredItem._isModule && this.hoveredItem.moduleName === mod.moduleName;
            const finalRadius = isHovered ? radius + 3 : radius;

            // Main circle
            ctx.arc(pos.x, pos.y, finalRadius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Border (dashed to indicate aggregate)
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label (file count)
            if (mod.fileCount > 1) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(mod.fileCount.toString(), pos.x, pos.y);
            }

            // Module name (if space permits)
            if (radius > 15 || isHovered) {
                ctx.fillStyle = '#334155';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const shortName = mod.moduleName.length > 15
                    ? mod.moduleName.substring(0, 12) + '...'
                    : mod.moduleName;
                ctx.fillText(shortName, pos.x, pos.y + finalRadius + 4);
            }
        });
    },

    drawExpandedModule: function(ctx, maxTests) {
        const mod = this.modules.find(m => m.moduleName === this.expandedModule);
        if (!mod) return;

        // Draw module boundary indicator
        ctx.fillStyle = 'rgba(37, 99, 235, 0.05)';
        ctx.fillRect(this.PADDING, this.PADDING, this.width - this.PADDING * 2, this.height - this.PADDING * 2);

        // Draw back button hint
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`📁 ${mod.moduleName} (${mod.fileCount} files) — Double-click to go back`, this.PADDING + 10, this.PADDING - 15);

        // Draw files in this module
        mod.files.forEach(item => {
            const pos = this.dataToScreen(item.testCount, item.coverage, maxTests);
            item._x = pos.x;
            item._y = pos.y;

            if (pos.x < -20 || pos.x > this.width + 20 || pos.y < -20 || pos.y > this.height + 20) {
                return;
            }

            this.drawFilePoint(ctx, item, pos);
        });
    },

    drawAllFiles: function(ctx, maxTests) {
        this.data.forEach(item => {
            const pos = this.dataToScreen(item.testCount, item.coverage, maxTests);
            item._x = pos.x;
            item._y = pos.y;

            // Viewport culling
            if (pos.x < -20 || pos.x > this.width + 20 || pos.y < -20 || pos.y > this.height + 20) {
                return;
            }

            this.drawFilePoint(ctx, item, pos);
        });
    },

    drawFilePoint: function(ctx, item, pos) {
        ctx.beginPath();

        // Selection ring
        if (this.selectedItem === item) {
            ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
            ctx.fill();
            ctx.beginPath();
        }

        const isHovered = this.hoveredItem === item;
        const radius = isHovered ? 6 : 4;
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = this.getCoverageColor(item.coverage, 0.7);
        ctx.fill();

        // Show filename label when zoomed in enough
        if (this.transform.scale > 4 || isHovered) {
            ctx.fillStyle = '#334155';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const shortName = item.fileName.length > 20
                ? item.fileName.substring(0, 17) + '...'
                : item.fileName;
            ctx.fillText(shortName, pos.x + 8, pos.y);
        }
    },

    getCoverageColor: function(coverage, alpha = 1.0) {
        if (coverage >= 80) return `rgba(16, 185, 129, ${alpha})`; // Green
        if (coverage >= 50) return `rgba(245, 158, 11, ${alpha})`; // Orange
        return `rgba(239, 68, 68, ${alpha})`; // Red
    },

    drawZoomIndicator: function(ctx) {
        const text = `${Math.round(this.transform.scale * 100)}%`;
        ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(text, this.width - 10, 20);

        // View mode indicator
        let mode = 'Modules';
        if (this.expandedModule) {
            mode = 'Module: ' + this.expandedModule;
        } else if (this.transform.scale >= this.AGGREGATE_THRESHOLD) {
            mode = 'Files';
        }
        ctx.fillText(mode, this.width - 10, 35);

        // Draw minimap when zoomed/panned
        if (this.transform.scale > 1.1 || Math.abs(this.transform.offsetX) > 10 || Math.abs(this.transform.offsetY) > 10) {
            this.drawMinimap(ctx);
        }
    },

    drawMinimap: function(ctx) {
        const mmWidth = 120;
        const mmHeight = 80;
        const mmX = this.width - mmWidth - 10;
        const mmY = 50;
        const mmPadding = 2;

        // Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmWidth, mmHeight, 4);
        ctx.fill();
        ctx.stroke();

        // Draw data points (simplified)
        const maxTests = Math.max(...this.data.map(d => d.testCount), 10);
        const chartW = mmWidth - mmPadding * 2;
        const chartH = mmHeight - mmPadding * 2;

        // Draw modules as small dots
        this.modules.forEach(mod => {
            const x = mmX + mmPadding + (mod.avgTestCount / maxTests * chartW);
            const y = mmY + mmPadding + chartH - (mod.avgCoverage / 100 * chartH);

            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = this.getCoverageColor(mod.avgCoverage, 0.5);
            ctx.fill();
        });

        // Draw viewport rectangle
        const viewScale = 1 / this.transform.scale;
        const viewW = this.width * viewScale;
        const viewH = this.height * viewScale;

        // Calculate viewport position in data space
        const viewCenterX = (this.width / 2 - this.transform.offsetX) / this.transform.scale;
        const viewCenterY = (this.height / 2 - this.transform.offsetY) / this.transform.scale;

        // Map to minimap coordinates
        const mmViewX = mmX + mmPadding + (viewCenterX / this.width * chartW) - (viewW / this.width * chartW / 2);
        const mmViewY = mmY + mmPadding + (viewCenterY / this.height * chartH) - (viewH / this.height * chartH / 2);
        const mmViewW = viewW / this.width * chartW;
        const mmViewH = viewH / this.height * chartH;

        ctx.strokeStyle = 'rgba(37, 99, 235, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
            Math.max(mmX + mmPadding, mmViewX),
            Math.max(mmY + mmPadding, mmViewY),
            Math.min(mmViewW, chartW),
            Math.min(mmViewH, chartH)
        );
    },

    // --- Event handlers ---

    onMouseMove: function (e) {
        if (this.isDragging) {
            // Pan
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.transform.offsetX = this.lastTransform.offsetX + dx;
            this.transform.offsetY = this.lastTransform.offsetY + dy;
            this.draw();
            return;
        }

        const item = this.hitTest(e);
        if (this.hoveredItem !== item) {
            this.canvas.style.cursor = item ? 'pointer' : (this.isDragging ? 'grabbing' : 'grab');
            this.hoveredItem = item;
            this.draw();
        }
    },

    onMouseLeave: function() {
        if (this.hoveredItem) {
            this.hoveredItem = null;
            this.draw();
        }
        this.isDragging = false;
    },

    onMouseDown: function(e) {
        if (e.button === 0) { // Left click
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.lastTransform = {
                offsetX: this.transform.offsetX,
                offsetY: this.transform.offsetY
            };
            this.canvas.style.cursor = 'grabbing';
        }
    },

    onMouseUp: function(e) {
        this.isDragging = false;
        this.canvas.style.cursor = this.hoveredItem ? 'pointer' : 'grab';
    },

    onClick: function (e) {
        const item = this.hitTest(e);
        if (item) {
            if (item._isModule) {
                // Click on module -> expand it
                this.expandedModule = item.moduleName;
                this.selectedItem = null;
                this.resetTransform();
                this.draw();

                // Notify Blazor
                if (this.dotNetRef) {
                    this.dotNetRef.invokeMethodAsync('OnModuleSelected', item.moduleName);
                }
            } else {
                // Click on file
                this.selectedItem = item;
                this.draw();
                if (this.dotNetRef) {
                    this.dotNetRef.invokeMethodAsync('OnItemSelected', item);
                }
            }
        }
    },

    onDoubleClick: function(e) {
        if (this.expandedModule) {
            // Go back to module view
            this.expandedModule = null;
            this.resetTransform();
            this.draw();

            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnModuleSelected', null);
            }
        } else {
            // Double click on module to expand
            const item = this.hitTest(e);
            if (item && item._isModule) {
                this.expandedModule = item.moduleName;
                this.resetTransform();
                this.draw();

                if (this.dotNetRef) {
                    this.dotNetRef.invokeMethodAsync('OnModuleSelected', item.moduleName);
                }
            } else {
                // Reset view
                this.resetTransform();
                this.draw();
            }
        }
    },

    onWheel: function(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate zoom
        const delta = -e.deltaY * this.ZOOM_SENSITIVITY;
        const newScale = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, this.transform.scale * (1 + delta)));

        if (newScale !== this.transform.scale) {
            // Zoom towards mouse position
            const scaleRatio = newScale / this.transform.scale;
            this.transform.offsetX = mouseX - (mouseX - this.transform.offsetX) * scaleRatio;
            this.transform.offsetY = mouseY - (mouseY - this.transform.offsetY) * scaleRatio;
            this.transform.scale = newScale;

            this.draw();
        }
    },

    hitTest: function (e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hitRadius = 15;

        // Check modules first (when in aggregate mode)
        if (!this.expandedModule && this.transform.scale < this.AGGREGATE_THRESHOLD) {
            // Use Quadtree if available
            if (this.moduleQuadtree) {
                const results = this.moduleQuadtree.queryCircle(x, y, 50);
                for (const { point: mod, dist } of results) {
                    const modRadius = 8 + Math.log(mod.fileCount + 1) * 6;
                    if (dist < modRadius + 5) {
                        return {
                            _isModule: true,
                            moduleName: mod.moduleName,
                            fileCount: mod.fileCount,
                            avgCoverage: mod.avgCoverage,
                            avgTestCount: mod.avgTestCount,
                            _x: mod._x,
                            _y: mod._y
                        };
                    }
                }
                return null;
            }

            // Fallback: linear search
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const mod = this.modules[i];
                const dx = mod._x - x;
                const dy = mod._y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const modRadius = 8 + Math.log(mod.fileCount + 1) * 6;

                if (dist < modRadius + 5) {
                    return {
                        _isModule: true,
                        moduleName: mod.moduleName,
                        fileCount: mod.fileCount,
                        avgCoverage: mod.avgCoverage,
                        avgTestCount: mod.avgTestCount,
                        _x: mod._x,
                        _y: mod._y
                    };
                }
            }
            return null;
        }

        // Check files - use Quadtree if available for large datasets
        if (this.quadtree && this.data.length > 500) {
            const files = this.expandedModule
                ? this.modules.find(m => m.moduleName === this.expandedModule)?.files || []
                : null;

            // If expanded module, build temporary quadtree for that module's files
            if (files) {
                let closest = null;
                let minDist = hitRadius;
                for (const item of files) {
                    const dx = item._x - x;
                    const dy = item._y - y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        minDist = dist;
                        closest = item;
                    }
                }
                return closest;
            }

            // Use main quadtree for all files
            return this.quadtree.findClosest(x, y, hitRadius);
        }

        // Fallback: linear search for files
        const files = this.expandedModule
            ? this.modules.find(m => m.moduleName === this.expandedModule)?.files || []
            : this.data;

        let closest = null;
        let minDist = hitRadius;

        for (let i = files.length - 1; i >= 0; i--) {
            const item = files[i];
            const dx = item._x - x;
            const dy = item._y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDist) {
                minDist = dist;
                closest = item;
            }
        }
        return closest;
    },

    drawTooltip: function (item) {
        const ctx = this.ctx;
        let text;

        if (item._isModule) {
            text = `📁 ${item.moduleName} | ${item.fileCount} files | Avg Cov: ${item.avgCoverage.toFixed(1)}%`;
        } else {
            text = `${item.fileName} | Tests: ${item.testCount} | Cov: ${item.coverage.toFixed(1)}%`;
        }

        const metrics = ctx.measureText(text);
        const padding = 8;
        const tooltipW = metrics.width + padding * 2;
        const tooltipH = 28;

        let x = item._x + 12;
        let y = item._y - 12;

        if (x + tooltipW > this.width) x = item._x - tooltipW - 12;
        if (y < 0) y = item._y + 12;
        if (y + tooltipH > this.height) y = this.height - tooltipH - 5;

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 4;

        ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
        ctx.beginPath();
        ctx.roundRect(x, y, tooltipW, tooltipH, 4);
        ctx.fill();

        ctx.shadowColor = 'transparent';

        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + padding, y + tooltipH / 2);
    },

    // Public API for Blazor
    setExpandedModule: function(moduleName) {
        this.expandedModule = moduleName;
        this.resetTransform();
        this.draw();
    },

    resetView: function() {
        this.expandedModule = null;
        this.resetTransform();
        this.selectedItem = null;
        this.draw();
    }
};
