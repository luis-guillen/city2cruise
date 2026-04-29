from rl_service.synthetic_data import generate_episode, inject_gps_noise
from rl_service.validation.robustness import evaluate_robustness, inject_packet_loss


def test_pipeline_survives_packet_loss():
    episode = generate_episode(seed=1)
    points = [(driver.lat, driver.lon) for driver in episode.drivers] * 50
    degraded = inject_packet_loss(points, loss_rate=0.10, seed=1)
    noisy = inject_gps_noise(list(degraded), seed=2, sigma_m=15.0)

    result = evaluate_robustness(noisy, expected_count=degraded.original_count)
    assert result["recovered_pct"] >= 0.90
    assert result["pass"] is True

