from setuptools import setup, find_packages

setup(
    name="parse-agents",
    version="0.1.0",
    description="Drop-in interceptor that screens every OpenAI/Anthropic client call with Parse prompt security.",
    long_description=open("README.md").read() if __import__("os").path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    license="ISC",
    author="Kurultai",
    packages=find_packages(),
    python_requires=">=3.9",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: ISC License (ISCL)",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Security",
    ],
)
