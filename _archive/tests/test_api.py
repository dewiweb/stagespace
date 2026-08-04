#!/usr/bin/env python3
"""
Test automatique de l'API OSCAI
Vérifie tous les endpoints et la génération de trajectoires
"""

import requests
import json
import time
from datetime import datetime

API_BASE = "http://localhost:8080"

def test_api_health():
    """Test endpoint racine"""
    print("\n" + "="*60)
    print("Test 1: API Health Check")
    print("="*60)
    
    try:
        response = requests.get(f"{API_BASE}/")
        print(f"✅ Status: {response.status_code}")
        data = response.json()
        print(f"✅ Name: {data.get('name')}")
        print(f"✅ Version: {data.get('version')}")
        print(f"✅ Model: {data.get('model')}")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_renderers_list():
    """Test liste des renderers OSC"""
    print("\n" + "="*60)
    print("Test 2: OSC Renderers List")
    print("="*60)
    
    try:
        response = requests.get(f"{API_BASE}/api/renderers")
        print(f"✅ Status: {response.status_code}")
        data = response.json()
        renderers = data.get('renderers', [])
        print(f"✅ Found {len(renderers)} renderers:")
        for renderer in renderers:
            print(f"   - {renderer['name']} ({renderer['format']}, port {renderer['default_port']})")
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_trajectory_generation():
    """Test génération de trajectoire"""
    print("\n" + "="*60)
    print("Test 3: Trajectory Generation (CPU - 20-30s)")
    print("="*60)
    
    prompt = "move object 1 in a circle for 8 seconds"
    print(f"Prompt: '{prompt}'")
    print("⏳ Generating (this will take 20-30s on CPU)...")
    
    start_time = time.time()
    
    try:
        response = requests.post(
            f"{API_BASE}/api/generate",
            json={"prompt": prompt, "use_cache": False},
            timeout=150
        )
        
        latency = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Status: {response.status_code}")
            print(f"✅ Latency: {latency:.2f}s")
            print(f"✅ Quality Score: {data.get('quality_score')}/100")
            print(f"✅ Trajectory ID: {data.get('id')}")
            
            trajectory = data.get('trajectory', {})
            print(f"✅ Duration: {trajectory.get('duration')}s")
            print(f"✅ Objects: {trajectory.get('objects')}")
            print(f"✅ Equations:")
            for axis, eq in trajectory.get('equations', {}).items():
                print(f"   {axis}: {eq}")
            
            metadata = trajectory.get('_metadata', {})
            auto_fixes = metadata.get('auto_fixes', [])
            if auto_fixes:
                print(f"⚡ Auto-fixes applied: {len(auto_fixes)}")
                for fix in auto_fixes:
                    print(f"   - {fix}")
            
            return True
        else:
            print(f"❌ Status: {response.status_code}")
            print(f"❌ Response: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"❌ Timeout after 150s")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_trajectory_cache():
    """Test cache des trajectoires"""
    print("\n" + "="*60)
    print("Test 4: Trajectory Cache")
    print("="*60)
    
    prompt = "move object 1 in a circle for 8 seconds"
    print(f"Prompt: '{prompt}' (should be cached)")
    print("⏳ Generating with cache...")
    
    start_time = time.time()
    
    try:
        response = requests.post(
            f"{API_BASE}/api/generate",
            json={"prompt": prompt, "use_cache": True},
            timeout=10
        )
        
        latency = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Status: {response.status_code}")
            print(f"✅ Latency: {latency:.2f}s (should be ~0s if cached)")
            
            if latency < 1.0:
                print(f"✅ Cache HIT - Instant response!")
            else:
                print(f"⚠️  Cache MISS - Generated new trajectory")
            
            return True
        else:
            print(f"❌ Status: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_trajectories_list():
    """Test liste des trajectoires"""
    print("\n" + "="*60)
    print("Test 5: Trajectories List")
    print("="*60)
    
    try:
        response = requests.get(f"{API_BASE}/api/trajectories")
        print(f"✅ Status: {response.status_code}")
        data = response.json()
        count = data.get('count', 0)
        print(f"✅ Cached trajectories: {count}")
        
        if count > 0:
            trajectories = data.get('trajectories', [])
            for traj in trajectories[:3]:
                print(f"   - {traj.get('id')} (quality: {traj.get('quality')})")
        
        return True
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def run_all_tests():
    """Exécute tous les tests"""
    print("\n" + "="*60)
    print("🧪 OSCAI API - Test Suite")
    print("="*60)
    print(f"API Base: {API_BASE}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    tests = [
        ("API Health", test_api_health),
        ("OSC Renderers", test_renderers_list),
        ("Trajectory Generation", test_trajectory_generation),
        ("Cache System", test_trajectory_cache),
        ("Trajectories List", test_trajectories_list),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ Test '{test_name}' crashed: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "="*60)
    print("📊 Test Summary")
    print("="*60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    import sys
    sys.exit(run_all_tests())
