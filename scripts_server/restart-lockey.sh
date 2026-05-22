#!/bin/bash
#===============================================================================
# Lockey - Script de gestion complet
#
# Usage:
#   ./restart-lockey.sh              Restart le service (sans build)
#   ./restart-lockey.sh --build      Build backend + frontend + restart
#   ./restart-lockey.sh --full       npm install + prisma generate + build + restart
#   ./restart-lockey.sh --install    npm install backend + frontend uniquement
#   ./restart-lockey.sh --backend    Build backend + restart (changements TS)
#   ./restart-lockey.sh --frontend   Build frontend uniquement (servi par le backend)
#   ./restart-lockey.sh --prisma     Prisma generate + build backend + restart
#   ./restart-lockey.sh --perms      Sécuriser le .env (600 root:root)
#   ./restart-lockey.sh --status     Statut du service
#   ./restart-lockey.sh --logs       Derniers logs
#===============================================================================

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "${CYAN}[>>>]${NC} $1"; }

# Privilèges root requis
if [[ $EUID -ne 0 ]]; then
    log_error "Ce script doit être exécuté en tant que root"
    exit 1
fi

# Configuration
LOCKEY_DIR="/opt/lockey"
BACKEND_DIR="$LOCKEY_DIR/server"
FRONTEND_DIR="$LOCKEY_DIR/client"
SERVICE_NAME="lockey"
BACKEND_PORT=3000

# ─── Fonctions ───

show_help() {
    echo ""
    echo "Usage: $0 [option]"
    echo ""
    echo "Options:"
    echo "  (aucune)        Restart le service backend (sans build)"
    echo "  -b, --build     Build backend + frontend + restart"
    echo "  -f, --full      npm install + prisma generate + build tout + restart"
    echo "  -i, --install   npm install backend + frontend uniquement"
    echo "  --backend       Build backend (tsc) + restart"
    echo "  --frontend      Build frontend (vite) uniquement"
    echo "  -p, --prisma    Prisma generate + build backend + restart"
    echo "  --perms         Sécuriser le .env (chmod 600)"
    echo "  -s, --status    Afficher le statut du service"
    echo "  -l, --logs      Afficher les derniers logs"
    echo "  -h, --help      Afficher cette aide"
    echo ""
}

fix_permissions() {
    log_step "Sécurisation du .env..."
    if [ -f "$BACKEND_DIR/.env" ]; then
        chmod 600 "$BACKEND_DIR/.env"
        chown root:root "$BACKEND_DIR/.env"
        log_success ".env: 600 root:root"
    else
        log_warning "Aucun .env dans $BACKEND_DIR (à créer depuis .env.example)"
    fi
}

do_install_backend() {
    log_step "npm install backend..."
    cd "$BACKEND_DIR"
    if npm install > /tmp/lockey-backend-install.log 2>&1; then
        log_success "Backend : npm install OK"
    else
        log_error "Échec npm install backend"
        tail -20 /tmp/lockey-backend-install.log
        exit 1
    fi
}

do_install_frontend() {
    log_step "npm install frontend..."
    cd "$FRONTEND_DIR"
    if npm install > /tmp/lockey-frontend-install.log 2>&1; then
        log_success "Frontend : npm install OK"
    else
        log_error "Échec npm install frontend"
        tail -20 /tmp/lockey-frontend-install.log
        exit 1
    fi
}

do_prisma_generate() {
    log_step "Prisma generate..."
    cd "$BACKEND_DIR"
    if npm run prisma:generate > /tmp/lockey-prisma-generate.log 2>&1; then
        log_success "Prisma client généré"
    else
        log_error "Échec prisma generate"
        tail -20 /tmp/lockey-prisma-generate.log
        exit 1
    fi
}

do_build_backend() {
    log_step "Build backend (tsc)..."
    cd "$BACKEND_DIR"
    if npm run build > /tmp/lockey-backend-build.log 2>&1; then
        log_success "Backend buildé (dist/index.js)"
    else
        log_error "Échec du build backend"
        tail -30 /tmp/lockey-backend-build.log
        exit 1
    fi
}

do_build_frontend() {
    log_step "Build frontend (vite)..."
    cd "$FRONTEND_DIR"
    if npm run build > /tmp/lockey-frontend-build.log 2>&1; then
        log_success "Frontend buildé (dist/)"
    else
        log_error "Échec du build frontend"
        tail -30 /tmp/lockey-frontend-build.log
        exit 1
    fi
}

stop_backend() {
    log_info "Arrêt du backend..."
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    sleep 1
}

start_backend() {
    log_info "Démarrage du backend..."
    systemctl reset-failed $SERVICE_NAME 2>/dev/null || true
    systemctl start $SERVICE_NAME
    sleep 2
    if systemctl is-active --quiet $SERVICE_NAME; then
        log_success "Backend démarré (port $BACKEND_PORT)"
    else
        log_error "Échec du démarrage du backend"
        journalctl -u $SERVICE_NAME -n 30 --no-pager
        exit 1
    fi
}

show_status() {
    echo ""
    echo "══════════════════════════════════════════════"
    echo "  Statut Lockey"
    echo "══════════════════════════════════════════════"
    echo ""
    echo -n "  Backend ($SERVICE_NAME):  "
    if systemctl is-active --quiet $SERVICE_NAME; then
        echo -e "${GREEN}ACTIF${NC} (port $BACKEND_PORT)"
    else
        echo -e "${RED}INACTIF${NC}"
    fi
    echo ""

    # Backend build
    if [ -f "$BACKEND_DIR/dist/index.js" ]; then
        local d=$(stat -c '%y' "$BACKEND_DIR/dist/index.js" 2>/dev/null | cut -c1-16)
        echo -e "  Backend dist:  ${GREEN}OK${NC} ($d)"
    else
        echo -e "  Backend dist:  ${RED}MANQUANT${NC} (lancer --backend)"
    fi

    # Frontend build
    if [ -f "$FRONTEND_DIR/dist/index.html" ]; then
        local d=$(stat -c '%y' "$FRONTEND_DIR/dist/index.html" 2>/dev/null | cut -c1-16)
        echo -e "  Frontend dist: ${GREEN}OK${NC} ($d)"
    else
        echo -e "  Frontend dist: ${RED}MANQUANT${NC} (lancer --frontend)"
    fi

    # PostgreSQL
    echo -n "  PostgreSQL:    "
    if systemctl is-active --quiet postgresql; then
        echo -e "${GREEN}ACTIF${NC}"
    else
        echo -e "${RED}INACTIF${NC}"
    fi
    echo ""

    # Espace disque
    echo "  Espace disque $LOCKEY_DIR:"
    du -sh "$LOCKEY_DIR" 2>/dev/null | awk '{print "    Total: "$1}'
    du -sh "$BACKEND_DIR/node_modules" 2>/dev/null | awk '{print "    Backend node_modules: "$1}'
    du -sh "$FRONTEND_DIR/node_modules" 2>/dev/null | awk '{print "    Frontend node_modules: "$1}'
    echo ""
}

show_summary() {
    echo ""
    echo "══════════════════════════════════════════════"
    echo "  Opération terminée"
    echo "══════════════════════════════════════════════"
    echo ""
    echo -n "  Backend:  "; systemctl is-active --quiet $SERVICE_NAME && echo -e "${GREEN}ACTIF${NC} (port $BACKEND_PORT)" || echo -e "${RED}INACTIF${NC}"
    echo ""
    echo "  Logs en direct: journalctl -u $SERVICE_NAME -f"
    echo ""
}

# ─── Exécution ───

case "${1:-restart}" in
    -h|--help)
        show_help
        ;;

    -s|--status)
        show_status
        ;;

    -l|--logs)
        echo ""
        log_info "=== Derniers logs ($SERVICE_NAME) ==="
        journalctl -u $SERVICE_NAME -n 50 --no-pager
        echo ""
        ;;

    --perms)
        fix_permissions
        ;;

    -i|--install)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - npm install"
        echo "══════════════════════════════════════════════"
        echo ""
        do_install_backend
        do_install_frontend
        log_success "Installation terminée"
        echo ""
        ;;

    --backend)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Build Backend + Restart"
        echo "══════════════════════════════════════════════"
        echo ""
        do_build_backend
        stop_backend
        start_backend
        show_summary
        ;;

    --frontend)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Build Frontend"
        echo "══════════════════════════════════════════════"
        echo ""
        do_build_frontend
        log_success "Frontend rebuildé (servi en statique par le backend)"
        echo ""
        ;;

    -p|--prisma)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Prisma + Backend + Restart"
        echo "══════════════════════════════════════════════"
        echo ""
        do_prisma_generate
        do_build_backend
        stop_backend
        start_backend
        show_summary
        ;;

    -b|--build)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Build complet + Restart"
        echo "══════════════════════════════════════════════"
        echo ""
        do_build_backend
        do_build_frontend
        stop_backend
        start_backend
        show_summary
        ;;

    -f|--full)
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Installation complète"
        echo "══════════════════════════════════════════════"
        echo ""
        do_install_backend
        do_install_frontend
        do_prisma_generate
        do_build_backend
        do_build_frontend
        fix_permissions
        stop_backend
        start_backend
        show_summary
        ;;

    restart|"")
        echo ""
        echo "══════════════════════════════════════════════"
        echo "  Lockey - Restart service"
        echo "══════════════════════════════════════════════"
        echo ""
        stop_backend
        start_backend
        show_summary
        ;;

    *)
        log_error "Option inconnue: $1"
        show_help
        exit 1
        ;;
esac
