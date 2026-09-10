# A14 Tests - Service Router

1. knee pain maps to ortho when active.
2. knee pain unsupported when no ortho service and general does_not_handle includes it.
3. child fever maps paediatric if configured.
4. adult fever maps general if configured.
5. tooth pain unsupported when no dental.
6. eye checkup unsupported when no eye service.
7. chest pain returns emergency path, not general service.
8. Two close matches return needsClarification.
9. Inactive service is not used.
10. Other clinic service is not used.
