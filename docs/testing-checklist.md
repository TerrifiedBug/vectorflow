# VectorFlow Manual Testing Checklist

## Prerequisites

1. Start the stack: `docker compose -f docker/docker-compose.yml up -d`
2. Open http://localhost:3000

## Test Workflow

### 1. First-Run Setup
- [ ] Visit http://localhost:3000 → redirects to /setup
- [ ] Complete setup wizard (name, email, password, team name)
- [ ] Redirects to /login after setup

### 2. Authentication
- [ ] Login with credentials created in setup
- [ ] Dashboard shows welcome page with stats
- [ ] User menu shows name and sign out option

### 3. Environments
- [ ] Navigate to Environments page
- [ ] Create new environment "dev" with API Reload mode
- [ ] Environment appears in list

### 4. Fleet Management
- [ ] Navigate to Fleet page
- [ ] Add a Vector node (name, host, port)
- [ ] Node appears with UNKNOWN status

### 5. Pipeline Builder
- [ ] Create new pipeline from Pipelines page
- [ ] Component palette shows Sources, Transforms, Sinks
- [ ] Drag a demo_logs source onto canvas
- [ ] Drag a remap transform onto canvas
- [ ] Drag a console sink onto canvas
- [ ] Connect source → transform → sink with edges
- [ ] Click on remap node → VRL editor appears in detail panel
- [ ] Save pipeline (Cmd+S)
- [ ] Undo/Redo works (Cmd+Z / Cmd+Shift+Z)

### 6. Config Export/Import
- [ ] Export pipeline as YAML → valid Vector config
- [ ] Export pipeline as TOML → valid Vector config
- [ ] Import an existing Vector YAML config → renders correctly

### 7. Validation
- [ ] Click validate button → shows result toast

### 8. Templates
- [ ] Navigate to Templates page
- [ ] Built-in templates displayed (Demo → Console, etc.)
- [ ] Click "Use Template" → creates new pipeline from template

### 9. Deployment
- [ ] Navigate to deploy page for a pipeline
- [ ] Config diff shown
- [ ] Deploy status display works

### 10. Audit Log
- [ ] Navigate to Audit page
- [ ] Actions from above steps are logged
- [ ] Filters work (action, user, date)

### 11. Settings
- [ ] Navigate to Settings page
- [ ] Auth settings tab works
- [ ] Fleet settings tab works
- [ ] Team management tab works

### 12. Dark/Light Theme
- [ ] Toggle theme → all pages render correctly in both modes

### 13. Health Check
- [ ] GET http://localhost:3000/api/health → returns { status: "ok", db: "connected" }
