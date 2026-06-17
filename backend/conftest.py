import os
import sys

# Make `import src...` work when pytest is run from the backend/ directory,
# mirroring how the app resolves packages (see src/paths.py).
sys.path.insert(0, os.path.dirname(__file__))
