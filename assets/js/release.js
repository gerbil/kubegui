async function getLatestReleaseVersion(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const data = await response.json();
    const version = data.tag_name || 'N/A';

    // Update all elements with class 'version'
    const versionElements = document.querySelectorAll('.release-version');
    versionElements.forEach(el => el.textContent = version);

  } catch (error) {
    console.error('Error fetching version:', error);
    const versionElements = document.querySelectorAll('.release-version');
    versionElements.forEach(el => el.textContent = 'Error');
  }
}