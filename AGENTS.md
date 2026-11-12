# orca-tycoon — Reglas del Repositorio y Flujo de Trabajo

Este repositorio contiene **Orca Tycoon** (Office Tycoon para Orca), adaptado y mejorado para Cyberpuerta.

## Remotes
- `origin`: `cyberpuerta/orca-tycoon` (repositorio del equipo)
- `personal`: `oscabreraCP/orca-tycoon` (fork personal de Oscar para enviar PRs)
- `upstream`: `palulabs/orca-tycoon` (repositorio original upstream de Palu Labs)

---

## Reglas Obligatorias de Desarrollo

1. **Una rama por cada cambio pequeño:**
   - Todo trabajo (feature, fix o doc) se realiza en su propia rama aislada (`feat/...`, `fix/...`, `docs/...`).
   - Cada cambio pequeño debe poder revisarse de manera individual e independiente.

2. **Prohibido hacer commits directos a `main`:**
   - Toda modificación debe entrar exclusivamente a través de Pull Request.
   - Jamás hacer `git commit` directamente en `main` (ni en local ni en remoto).

3. **Respeto total a cambios y trabajo existente:**
   - Nunca descartar (`git restore`, `git reset --hard`), borrar o sobrescribir cambios previos o trabajo en curso que Oscar tenga en el árbol de trabajo o en otras ramas.

4. **Reglas para contribución hacia `palulabs/orca-tycoon` (Upstream de Palu Labs):**
   - **Preguntar SIEMPRE a Oscar:** Antes de abrir cualquier PR o enviar código a `palulabs/orca-tycoon`, es **obligatorio preguntar primero y esperar confirmación explícita**.
   - **Solo "Need you":** Hacia `palulabs/orca-tycoon` **únicamente se propone y envía la funcionalidad de "Need you"** (detección de agentes esperando respuesta con `agentWait`, sprite animado `?` y globo de pensamiento continuo).
   - **NO enviar lo de líderes:** Las funcionalidades de líderes, orquestadores/coordinadores, coronas 👑 y botones de líder son personalizaciones internas para Cyberpuerta/Stratos y **permanecen exclusivamente en `cyberpuerta/orca-tycoon`**.

---

## Verificación y Pruebas
- Correr pruebas: `/Applications/Orca.app/Contents/Resources/bin/orca plugin test`
- Recargar plugin en caliente en Orca: `/Applications/Orca.app/Contents/Resources/bin/orca plugin dev reload`
