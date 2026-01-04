/**
 * Quadtree for efficient spatial queries
 * Optimizes hit testing from O(n) to O(log n)
 */
class Quadtree {
    constructor(bounds, capacity = 10) {
        this.bounds = bounds; // { x, y, width, height }
        this.capacity = capacity;
        this.points = [];
        this.divided = false;
        this.nw = null;
        this.ne = null;
        this.sw = null;
        this.se = null;
    }

    /**
     * Check if a point is within bounds
     */
    contains(point) {
        return (
            point._x >= this.bounds.x &&
            point._x < this.bounds.x + this.bounds.width &&
            point._y >= this.bounds.y &&
            point._y < this.bounds.y + this.bounds.height
        );
    }

    /**
     * Check if bounds intersect with a circle
     */
    intersectsCircle(cx, cy, radius) {
        // Find the closest point on the rectangle to the circle center
        const closestX = Math.max(this.bounds.x, Math.min(cx, this.bounds.x + this.bounds.width));
        const closestY = Math.max(this.bounds.y, Math.min(cy, this.bounds.y + this.bounds.height));

        // Calculate distance from circle center to closest point
        const dx = cx - closestX;
        const dy = cy - closestY;

        return (dx * dx + dy * dy) <= (radius * radius);
    }

    /**
     * Subdivide this node into 4 quadrants
     */
    subdivide() {
        const x = this.bounds.x;
        const y = this.bounds.y;
        const hw = this.bounds.width / 2;
        const hh = this.bounds.height / 2;

        this.nw = new Quadtree({ x: x, y: y, width: hw, height: hh }, this.capacity);
        this.ne = new Quadtree({ x: x + hw, y: y, width: hw, height: hh }, this.capacity);
        this.sw = new Quadtree({ x: x, y: y + hh, width: hw, height: hh }, this.capacity);
        this.se = new Quadtree({ x: x + hw, y: y + hh, width: hw, height: hh }, this.capacity);

        this.divided = true;
    }

    /**
     * Insert a point into the quadtree
     */
    insert(point) {
        // Ignore points outside bounds
        if (!this.contains(point)) {
            return false;
        }

        // If there's capacity, add the point here
        if (this.points.length < this.capacity) {
            this.points.push(point);
            return true;
        }

        // Otherwise, subdivide if necessary and insert into children
        if (!this.divided) {
            this.subdivide();
        }

        return (
            this.nw.insert(point) ||
            this.ne.insert(point) ||
            this.sw.insert(point) ||
            this.se.insert(point)
        );
    }

    /**
     * Query all points within a circular range
     */
    queryCircle(cx, cy, radius, found = []) {
        // Early exit if this quadrant doesn't intersect the circle
        if (!this.intersectsCircle(cx, cy, radius)) {
            return found;
        }

        // Check points in this node
        for (const point of this.points) {
            const dx = point._x - cx;
            const dy = point._y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= radius) {
                found.push({ point, dist });
            }
        }

        // Recursively search children
        if (this.divided) {
            this.nw.queryCircle(cx, cy, radius, found);
            this.ne.queryCircle(cx, cy, radius, found);
            this.sw.queryCircle(cx, cy, radius, found);
            this.se.queryCircle(cx, cy, radius, found);
        }

        return found;
    }

    /**
     * Query all points within a rectangular range
     */
    queryRect(rect, found = []) {
        // Early exit if no intersection
        if (!this.intersectsRect(rect)) {
            return found;
        }

        // Check points in this node
        for (const point of this.points) {
            if (
                point._x >= rect.x &&
                point._x < rect.x + rect.width &&
                point._y >= rect.y &&
                point._y < rect.y + rect.height
            ) {
                found.push(point);
            }
        }

        // Recursively search children
        if (this.divided) {
            this.nw.queryRect(rect, found);
            this.ne.queryRect(rect, found);
            this.sw.queryRect(rect, found);
            this.se.queryRect(rect, found);
        }

        return found;
    }

    intersectsRect(rect) {
        return !(
            rect.x > this.bounds.x + this.bounds.width ||
            rect.x + rect.width < this.bounds.x ||
            rect.y > this.bounds.y + this.bounds.height ||
            rect.y + rect.height < this.bounds.y
        );
    }

    /**
     * Find the closest point to a given coordinate
     */
    findClosest(cx, cy, maxRadius = Infinity) {
        const results = this.queryCircle(cx, cy, maxRadius);

        if (results.length === 0) {
            return null;
        }

        // Sort by distance and return closest
        results.sort((a, b) => a.dist - b.dist);
        return results[0].point;
    }

    /**
     * Clear all points from the quadtree
     */
    clear() {
        this.points = [];
        this.divided = false;
        this.nw = null;
        this.ne = null;
        this.sw = null;
        this.se = null;
    }

    /**
     * Get total point count (for debugging)
     */
    get count() {
        let total = this.points.length;
        if (this.divided) {
            total += this.nw.count + this.ne.count + this.sw.count + this.se.count;
        }
        return total;
    }
}

// Export for use in dotplot.js
window.Quadtree = Quadtree;
