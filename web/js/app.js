// Features Data
const features = [
    { title: "Air-Gap Ready", desc: "No external dependencies. Works in isolated environments.", icon: "" },
    { title: "Real-time Metrics", desc: "Integrated Node and Pod metrics with auto-refresh.", icon: "" },
    { title: "One-Click Shell", desc: "Direct pod access without the CLI hassle.", icon: "" },
    { title: "Smart Logs", desc: "Syntax highlighting and severity levels for all logs.", icon: "" },
    { title: "YAML Editor", desc: "Resource editor with validation and solarized theme support.", icon: "" },
    { title: "Events Aggregation", desc: "Deployments-centric events viewer with real-time updates.", icon: "" },
    { title: "Performance Monitoring", desc: "Full Custom Resource Definition support with schema validation.", icon: "" },
    { title: "AI Fix Suggestions", desc: "Intelligent error detection with automated fix recommendations.", icon: "" }
];

const uniqueFeatures = [
    {
        number: "01",
        title: "Custom Resource Creation",
        desc: "Custom Resource generation from existing definition manifests. Any available CRD provides a schema used within KubeGUI to automagically generate Custom Resource example."
    },
    {
        number: "02",
        title: "Network policies visualizer",
        desc: "Lightweight visual network policy visualizer. Check network policies with ease using our intuitive visual interface."
    },
    {
        number: "03",
        title: "Aggregated deployments logs",
        desc: "Deployments live logs view aggregated and shown for any running/changing pods."
    }
];

const roadmap = [
    { quarter: "2026 Q1-Q2", title: "Live updates speed and quality", desc: "Moving to single resource SSE instead of HTTP" },
    { quarter: "2026 Q2-Q3", title: "Advanced Config & Styling", desc: "More customization options for fonts and themes" },
    { quarter: "2026 Q3-Q4", title: "Custom Alert System", desc: "Event notifications and custom alerts" }
];

// Render Features
function renderFeatures() {
    const grid = document.querySelector('.features-grid');
    features.forEach((feature, idx) => {
        const card = document.createElement('div');
        card.className = 'feature-card';
        card.setAttribute('data-testid', `feature-card-${idx}`);
        card.innerHTML = `
            <div class="feature-icon">${feature.icon}</div>
            <h3 class="feature-title">${feature.title}</h3>
            <p class="feature-desc">${feature.desc}</p>
        `;
        grid.appendChild(card);
    });
}

// Render Unique Features
function renderUniqueFeatures() {
    const grid = document.querySelector('.unique-grid');
    uniqueFeatures.forEach((feature, idx) => {
        const card = document.createElement('div');
        card.className = 'unique-card';
        card.setAttribute('data-testid', `unique-feature-${idx}`);
        card.innerHTML = `
            <div class="feature-number">${feature.number}</div>
            <h3 class="unique-title">${feature.title}</h3>
            <p class="unique-desc">${feature.desc}</p>
        `;
        grid.appendChild(card);
    });
}

// Render Roadmap
function renderRoadmap() {
    const container = document.querySelector('.roadmap-container');
    roadmap.forEach((item, idx) => {
        const roadmapItem = document.createElement('div');
        roadmapItem.className = 'roadmap-item';
        roadmapItem.setAttribute('data-testid', `roadmap-item-${idx}`);
        roadmapItem.innerHTML = `
            <div class="roadmap-node"></div>
            <div class="roadmap-content">
                <div class="roadmap-quarter">${item.quarter}</div>
                <h3 class="roadmap-title">${item.title}</h3>
                <p class="roadmap-desc">${item.desc}</p>
            </div>
        `;
        container.appendChild(roadmapItem);
    });
}

// Scroll Animations
function observeElements() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.feature-card, .unique-card, .roadmap-item, .section-title, .section-subtitle').forEach(el => {
        el.classList.add('fade-in');
        observer.observe(el);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    renderFeatures();
    renderUniqueFeatures();
    renderRoadmap();
    
    setTimeout(() => {
        observeElements();
    }, 100);
});