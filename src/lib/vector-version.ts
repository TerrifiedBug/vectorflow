// Single source of truth for the version of vector.dev that VectorFlow ships
// in its server image and pre-installs on agent nodes. When bumping, update
// the matching `ARG VECTOR_VERSION=` defaults in:
//   - docker/server/Dockerfile
//   - agent/Dockerfile
//   - agent/install.sh
// (a CI check could be added later to enforce the cross-file alignment).

export const VECTOR_VERSION = "0.54.0";
