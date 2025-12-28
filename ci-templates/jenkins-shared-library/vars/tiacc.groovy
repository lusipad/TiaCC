#!/usr/bin/env groovy
/**
 * TiaCC Jenkins Shared Library
 *
 * Usage in Jenkinsfile:
 *   @Library('tiacc') _
 *
 *   pipeline {
 *       agent any
 *       stages {
 *           stage('Test') {
 *               steps {
 *                   script {
 *                       def affectedTests = tiacc.recommend()
 *                       if (affectedTests) {
 *                           sh "npm test -- --grep '${affectedTests}'"
 *                       } else {
 *                           sh 'npm test'
 *                       }
 *                   }
 *               }
 *           }
 *       }
 *   }
 */

/**
 * Install TiaCC tools
 */
def install(Map config = [:]) {
    def version = config.version ?: 'latest'
    sh "npm install -g @tiacc/tools@${version}"
}

/**
 * Build TiaCC mapping from coverage data
 */
def build(Map config = [:]) {
    def coverageDir = config.coverageDir ?: './coverage'
    def database = config.database ?: 'impact_map.db'
    def format = config.format ?: 'auto'
    def verbose = config.verbose ?: false

    def formatArg = getFormatArg(format)
    def verboseArg = verbose ? '-v' : ''

    sh """
        tia-mapper build \
            -c ${coverageDir} \
            -d ${database} \
            ${formatArg} \
            ${verboseArg}
    """

    // Archive database
    archiveArtifacts artifacts: database, fingerprint: true

    return database
}

/**
 * Get recommended tests based on changed files
 */
def recommend(Map config = [:]) {
    def database = config.database ?: 'impact_map.db'
    def baseBranch = config.baseBranch ?: 'origin/main'
    def verbose = config.verbose ?: false

    // Restore database if not present
    if (!fileExists(database)) {
        try {
            copyArtifacts(
                projectName: env.JOB_NAME,
                filter: database,
                selector: lastSuccessful(),
                optional: true
            )
        } catch (Exception e) {
            echo "No TiaCC database found"
            return null
        }
    }

    if (!fileExists(database)) {
        echo "No TiaCC database available. Run all tests."
        return null
    }

    // For PRs, use the target branch
    if (env.CHANGE_TARGET) {
        baseBranch = "origin/${env.CHANGE_TARGET}"
    }

    def verboseArg = verbose ? '-v' : ''

    def affectedTests = sh(
        script: """
            tia-recommend \
                --db ${database} \
                --base ${baseBranch} \
                ${verboseArg} 2>/dev/null || true
        """,
        returnStdout: true
    ).trim()

    if (affectedTests) {
        echo "=== TiaCC Affected Tests ==="
        echo affectedTests
        echo "============================="
        writeFile file: 'affected-tests.txt', text: affectedTests
        return affectedTests
    }

    return null
}

/**
 * Run tests with TiaCC integration
 * Automatically detects if running on PR or main branch
 */
def runTests(Map config = [:]) {
    def allTestsCommand = config.allTestsCommand ?: 'npm test'
    def affectedTestsCommand = config.affectedTestsCommand ?: null
    def coverageDir = config.coverageDir ?: './coverage'
    def database = config.database ?: 'impact_map.db'
    def format = config.format ?: 'auto'

    if (isPR()) {
        // PR: Run affected tests only
        def affectedTests = recommend(database: database)

        if (affectedTests && affectedTestsCommand) {
            def cmd = affectedTestsCommand.replace('${AFFECTED_TESTS}', affectedTests)
            sh cmd
        } else {
            sh allTestsCommand
        }
    } else if (isMainBranch()) {
        // Main branch: Run all tests with coverage and build mapping
        sh allTestsCommand
        build(coverageDir: coverageDir, database: database, format: format)
    } else {
        // Other branches: Just run tests
        sh allTestsCommand
    }
}

/**
 * Get affected test count
 */
def getAffectedCount(Map config = [:]) {
    def database = config.database ?: 'impact_map.db'
    def affectedTests = recommend(database: database)

    if (affectedTests) {
        return affectedTests.split('\n').size()
    }
    return 0
}

// Private helpers
private def getFormatArg(String format) {
    switch(format) {
        case 'lcov': return '--lcov'
        case 'jacoco': return '--jacoco'
        case 'istanbul': return '--istanbul'
        case 'coveragepy': return '--coveragepy'
        case 'dotcover': return '--dotcover'
        case 'opencppcoverage': return '--opencppcoverage'
        case 'cobertura': return ''
        default: return ''
    }
}

private def isPR() {
    return env.CHANGE_ID != null
}

private def isMainBranch() {
    return env.BRANCH_NAME in ['main', 'master']
}
