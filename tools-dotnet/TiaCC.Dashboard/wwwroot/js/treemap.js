// Treemap visualization using pure JavaScript (no D3 dependency)
window.renderTreemap = function (container, data) {
    if (!container || !data) return;

    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    if (!data.children || data.children.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-muted);">No data to display</p>';
        return;
    }

    // Simple treemap layout algorithm
    const nodes = layoutTreemap(data, 0, 0, width, height);

    // Render nodes
    nodes.forEach(node => {
        const div = document.createElement('div');
        div.className = 'treemap-cell';
        div.style.position = 'absolute';
        div.style.left = node.x + 'px';
        div.style.top = node.y + 'px';
        div.style.width = Math.max(0, node.width - 2) + 'px';
        div.style.height = Math.max(0, node.height - 2) + 'px';
        div.style.backgroundColor = getCoverageColor(node.coverage);

        if (node.width > 40 && node.height > 20) {
            div.textContent = node.name;
        }

        div.title = `${node.name}\nCoverage: ${node.coverage.toFixed(1)}%\n${node.isDirectory ? 'Directory' : 'File'}`;

        div.onclick = function () {
            DotNet.invokeMethodAsync('TiaCC.Dashboard', 'OnTreemapNodeClick', node.fullPath, node.isDirectory);
        };

        container.appendChild(div);
    });

    container.style.position = 'relative';
};

function layoutTreemap(node, x, y, width, height) {
    const nodes = [];

    if (!node.children || node.children.length === 0) {
        nodes.push({
            name: node.name,
            fullPath: node.fullPath,
            coverage: node.coverage,
            isDirectory: node.isDirectory,
            x: x,
            y: y,
            width: width,
            height: height
        });
        return nodes;
    }

    // Calculate total value
    const totalValue = node.children.reduce((sum, child) => sum + (child.value || 1), 0);

    // Squarified treemap layout
    let currentX = x;
    let currentY = y;
    let remainingWidth = width;
    let remainingHeight = height;

    // Sort children by value (descending)
    const sortedChildren = [...node.children].sort((a, b) => (b.value || 1) - (a.value || 1));

    // Simple strip-based layout
    const isHorizontal = width > height;
    let accumulated = 0;

    sortedChildren.forEach((child, index) => {
        const childValue = child.value || 1;
        const ratio = childValue / totalValue;

        let childWidth, childHeight, childX, childY;

        if (isHorizontal) {
            childWidth = width * ratio;
            childHeight = height;
            childX = x + accumulated * width / totalValue;
            childY = y;
        } else {
            childWidth = width;
            childHeight = height * ratio;
            childX = x;
            childY = y + accumulated * height / totalValue;
        }

        accumulated += childValue;

        if (child.isDirectory && child.children && child.children.length > 0) {
            // Recursively layout children
            const childNodes = layoutTreemap(child, childX, childY, childWidth, childHeight);
            nodes.push(...childNodes);
        } else {
            nodes.push({
                name: child.name,
                fullPath: child.fullPath,
                coverage: child.coverage,
                isDirectory: child.isDirectory,
                x: childX,
                y: childY,
                width: childWidth,
                height: childHeight
            });
        }
    });

    return nodes;
}

function getCoverageColor(coverage) {
    if (coverage >= 80) {
        // Green gradient
        const intensity = Math.min(255, 100 + (coverage - 80) * 7.75);
        return `rgb(16, ${intensity}, 97)`;
    } else if (coverage >= 50) {
        // Yellow/Orange gradient
        const ratio = (coverage - 50) / 30;
        const r = Math.floor(245 - ratio * 100);
        const g = Math.floor(158 + ratio * 20);
        return `rgb(${r}, ${g}, 11)`;
    } else {
        // Red gradient
        const intensity = Math.min(255, 68 + coverage * 1.5);
        return `rgb(239, ${intensity}, ${intensity})`;
    }
}
